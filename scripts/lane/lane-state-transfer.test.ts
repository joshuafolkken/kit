import { repository_lock } from '#scripts/git/repository-lock'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry } from '#scripts/run/carry/run-carry'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_state } from './lane-state'

// joshuafolkken/kit#8455: a run that adopts a lane its ended owner left behind takes the record over.

const make_directory = temporary_directory()

const ISSUE = '8455'
const DISPATCH = 'lane:dispatch'
const EARLIER_START = new Date('2026-11-21T04:00:00.000Z')
const LAUNCHED_AT = new Date('2026-11-21T04:17:00.000Z')
const CURRENT_START = new Date('2026-11-21T09:00:00.000Z')
const ADOPTED_AT = new Date('2026-11-21T09:05:00.000Z')
const EARLIER_OWNER = 12_844
const CURRENT_OWNER = 56_029
const NOTHING_TO_TRANSFER = { kind: 'skipped', reason: 'no record or run' }

const state = { directory: '' }

function write_carry(started: Date, pid: number): void {
	const carry = run_carry.fresh_carry('backlogrun', { pid }, started)

	stamp_file.replace_stamp(run_carry.carry_path(state.directory), carry)
}

async function launch_under_earlier_run(): Promise<void> {
	write_carry(EARLIER_START, EARLIER_OWNER)
	await lane_state.record_change(
		{ issue: ISSUE, state: 'running', command: DISPATCH, is_launch: true },
		{ directory: state.directory, now: LAUNCHED_AT },
	)
}

async function transfer(): Promise<Awaited<ReturnType<typeof lane_state.record_transfer>>> {
	return await lane_state.record_transfer(ISSUE, { directory: state.directory, now: ADOPTED_AT })
}

beforeEach(() => {
	state.directory = make_directory('lane-state-transfer-')
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
	stamp_file.remove_stamp(run_carry.carry_path(state.directory))
	stamp_file.remove_stamp(lane_state.state_path(state.directory, ISSUE))
	vi.restoreAllMocks()
})

describe('lane_state.record_transfer', () => {
	it('hands the record to the current run, keeping its state and launch', async () => {
		await launch_under_earlier_run()
		write_carry(CURRENT_START, CURRENT_OWNER)

		const outcome = await transfer()

		expect(outcome.kind).toBe('written')
		await expect(lane_state.read_state(ISSUE, state.directory)).resolves.toMatchObject({
			state: 'running',
			changed_by: DISPATCH,
			launched_at: LAUNCHED_AT.toISOString(),
			adopted_at: ADOPTED_AT.toISOString(),
			run: { started_at: CURRENT_START.toISOString(), owner_pid: CURRENT_OWNER },
		})
	})

	it('skips a lane with no record', async () => {
		write_carry(CURRENT_START, CURRENT_OWNER)

		expect(await transfer()).toStrictEqual(NOTHING_TO_TRANSFER)
	})

	it('skips with no current run, leaving the record as it is', async () => {
		await launch_under_earlier_run()
		stamp_file.remove_stamp(run_carry.carry_path(state.directory))

		expect(await transfer()).toStrictEqual(NOTHING_TO_TRANSFER)
		await expect(lane_state.read_state(ISSUE, state.directory)).resolves.not.toHaveProperty(
			'adopted_at',
		)
	})

	it('answers a write that threw as skipped, not as an error', async () => {
		vi.spyOn(repository_lock, 'with_lock_sync').mockImplementation(() => {
			throw new Error('ENOSPC')
		})

		expect(await transfer()).toStrictEqual({ kind: 'skipped', reason: 'ENOSPC' })
	})
})

describe('lane_state.record_change after a transfer', () => {
	it('drops the hand-over when the adopting run relaunches the lane', async () => {
		await launch_under_earlier_run()
		write_carry(CURRENT_START, CURRENT_OWNER)
		await transfer()
		await lane_state.record_change(
			{ issue: ISSUE, state: 'running', command: 'lane:restart', is_launch: true },
			{ directory: state.directory, now: ADOPTED_AT },
		)

		await expect(lane_state.read_state(ISSUE, state.directory)).resolves.not.toHaveProperty(
			'adopted_at',
		)
	})
})
