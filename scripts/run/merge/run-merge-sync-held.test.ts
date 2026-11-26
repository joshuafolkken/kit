import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_transition_guards } from '#scripts/lane/lane-transition-guards'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { run_merge_sync_held } from './run-merge-sync-held'

const CHILD = '9034'
const HOLDER = 'checkout-not-held-by-another-run: #7686 holds it'
const REFUSAL = 'error: The following untracked working tree files would be overwritten by merge'

const make_directory = temporary_directory()
const marker_of = { path: '' }

function marker(): string {
	return marker_of.path
}

beforeEach(() => {
	const common = make_directory('sync-held-')

	marker_of.path = path.join(
		common,
		git_common_directory.STATE_DIRECTORY,
		run_merge_sync_held.MARKER_NAME,
	)
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(common)
	vi.spyOn(console, 'error').mockReturnValue()
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
})

describe('run_merge_sync_held.hold (joshuafolkken/kit#9034)', () => {
	let warn: MockInstance<typeof telegram_notify.warn>

	beforeEach(() => {
		warn = vi.spyOn(telegram_notify, 'warn').mockResolvedValue(true)
	})

	it('writes the marker and tells the person once across repeated holds', async () => {
		await run_merge_sync_held.hold(CHILD)
		await run_merge_sync_held.hold(CHILD)

		expect(existsSync(marker())).toBe(true)
		expect(warn).toHaveBeenCalledTimes(1)
	})
})

describe('run_merge_sync_held.is_refusal (joshuafolkken/kit#9034)', () => {
	it.each([
		'error: Your local changes to the following files would be overwritten by checkout',
		'error: Your local changes to the following files would be overwritten by merge',
		REFUSAL,
	])('reads git’s local-changes refusal: %s', (text) => {
		expect(run_merge_sync_held.is_refusal(text)).toBe(true)
	})

	it('reads any other failure as no refusal', () => {
		expect(run_merge_sync_held.is_refusal('fatal: Not possible to fast-forward, aborting')).toBe(
			false,
		)
	})
})

describe('run_merge_sync_held.is_held (joshuafolkken/kit#9034)', () => {
	let josh_run: MockInstance<typeof josh_command.josh_run>

	beforeEach(async () => {
		vi.spyOn(telegram_notify, 'warn').mockResolvedValue(true)
		josh_run = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' })
		vi.spyOn(lane_transition_guards, 'rejection').mockResolvedValue(undefined)
		await run_merge_sync_held.hold(CHILD)
	})

	it('answers false with no marker', async () => {
		rmSync(marker())

		await expect(run_merge_sync_held.is_held()).resolves.toBe(false)
	})

	it('keeps holding while the checkout still refuses the sync', async () => {
		josh_run.mockResolvedValue({ code: 1, out: '', err: REFUSAL })

		await expect(run_merge_sync_held.is_held()).resolves.toBe(true)
		expect(existsSync(marker())).toBe(true)
	})

	it('syncs and clears the marker once the sync goes through, dirty tree or not', async () => {
		await expect(run_merge_sync_held.is_held()).resolves.toBe(false)
		expect(josh_run).toHaveBeenCalledWith(['main:sync'])
		expect(existsSync(marker())).toBe(false)
	})

	it('clears the marker without syncing once another run holds the checkout', async () => {
		vi.spyOn(lane_transition_guards, 'rejection').mockResolvedValue(HOLDER)

		await expect(run_merge_sync_held.is_held()).resolves.toBe(false)
		expect(josh_run).not.toHaveBeenCalled()
		expect(existsSync(marker())).toBe(false)
	})
})
