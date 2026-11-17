import { josh_command } from '#scripts/josh/josh-run'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_hold, type HoldRead, type RunHold } from '#scripts/run/hold/run-hold'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { run_merge_sync } from './run-merge-sync'

const CHILD = '7697'
const HOLDER = '7686'
const SYNC = 'main:sync'

interface SyncSpies {
	josh_run: MockInstance<typeof josh_command.josh_run>
	emit: MockInstance<typeof run_event_stream_emit.emit>
}

function hold_of(issue: string): RunHold {
	return { issue, taken_at: new Date().toISOString(), pid: 1 }
}

function held_by(issue: string): HoldRead {
	return { kind: 'held', hold: hold_of(issue) }
}

function stub_sync(): SyncSpies {
	vi.spyOn(console, 'error').mockReturnValue()

	return {
		josh_run: vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' }),
		emit: vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue(),
	}
}

function stub_tree(read: HoldRead): void {
	vi.spyOn(run_hold, 'worktree_directory').mockResolvedValue('/primary/.git')
	vi.spyOn(run_hold, 'read_hold').mockReturnValue(read)
}

function did_sync(spies: SyncSpies): boolean {
	return spies.josh_run.mock.calls.some(([args]) => args[0] === SYNC)
}

describe('run_merge_sync.sync_main — another run holds the checkout (joshuafolkken/kit#7716)', () => {
	let spies: SyncSpies

	beforeEach(() => {
		spies = stub_sync()
	})

	it('neither switches the held checkout to main nor pulls its main', async () => {
		stub_tree(held_by(HOLDER))

		await run_merge_sync.sync_main(CHILD)

		expect(did_sync(spies)).toBe(false)
	})

	it('puts the skip and the holder on the run’s event stream', async () => {
		stub_tree(held_by(HOLDER))

		await run_merge_sync.sync_main(CHILD)

		expect(spies.emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.NOTE,
			expect.stringMatching(new RegExp(`${SYNC} skipped.*#${HOLDER}`, 'u')),
		)
	})

	it('skips a checkout whose hold record is unreadable', async () => {
		stub_tree({ kind: 'unreadable' })

		await run_merge_sync.sync_main(CHILD)

		expect(did_sync(spies)).toBe(false)
	})
})

describe('run_merge_sync.sync_main — a checkout no other run holds', () => {
	let spies: SyncSpies

	beforeEach(() => {
		spies = stub_sync()
	})

	it.each<[string, HoldRead]>([
		['no hold', { kind: 'free' }],
		['a stale hold', { kind: 'stale', hold: hold_of(HOLDER) }],
		['the merged child’s own hold', held_by(CHILD)],
	])('runs main:sync as before under %s', async (_label, read) => {
		stub_tree(read)

		await run_merge_sync.sync_main(CHILD)

		expect(did_sync(spies)).toBe(true)
		expect(spies.emit).not.toHaveBeenCalled()
	})
})
