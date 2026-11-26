import { spawn } from 'node:child_process'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_carry_added } from '#scripts/run/carry/run-carry-added'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { temporary_directory } from '#tools/test/temporary-directory'
import { expect, test, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_named } from './backlog-drive-named'

const ACTIVE = '2026-09-24T00:00:00.000Z'
const make_directory = temporary_directory()
const CARRY = {
	invocation: 'backlogrun #1 #2 --only',
	started_at: ACTIVE,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

// joshuafolkken/kit#8953: every named issue left is offered at once, in the typed order.
test('offers every named issue left at once, in the typed order', () => {
	const empty = backlog_drive.initial_state([], ACTIVE)

	expect(backlog_drive_named.offer(CARRY, empty, true)).toMatchObject({
		verdict: 'run',
		issues: ['1', '2'],
	})
})

test('offers the named issues not in flight, past one that is', () => {
	const running = backlog_drive.initial_state(['1'], ACTIVE)

	expect(backlog_drive_named.offer(CARRY, running, true)).toMatchObject({
		verdict: 'run',
		issues: ['2'],
	})
	expect(backlog_drive_named.pending_of(CARRY, ['1'])).toStrictEqual([2])
})

// joshuafolkken/kit#6883: with every named issue in flight, the pool fills the free lanes.
test('names nothing when every named issue left is in flight, so the pool is asked', () => {
	const carry = { ...CARRY, done: [1] }
	const running = backlog_drive.initial_state(['2'], ACTIVE)

	expect(backlog_drive_named.offer(carry, running, false)).toBeUndefined()
})

test('gives the wait an --only run holds for its last named issue its own cause', () => {
	const carry = { ...CARRY, done: [1, 2], added: [{ issue: 9, is_priority: false }] }
	const running = backlog_drive.initial_state(['9'], ACTIVE)

	expect(backlog_drive_named.offer(carry, running, true)).toMatchObject({
		verdict: 'wait',
		cause: 'only',
	})
})

// joshuafolkken/kit#4746: the stop's reason is read when it is offered, so one offered while a lane ran
// named that lane's issue unmerged even after it merged.
test('ends an --only run with every named issue done only once nothing is in flight', () => {
	const carry = { ...CARRY, done: [1, 2] }
	const running = backlog_drive.initial_state(['2'], ACTIVE)
	const settled = backlog_drive.initial_state([], ACTIVE)

	expect(backlog_drive_named.offer(carry, running, true)?.verdict).toBe('wait')
	expect(backlog_drive_named.offer(carry, settled, true)).toMatchObject({
		verdict: 'stop',
		reason: 'only',
		is_finish: true,
	})
})

// joshuafolkken/kit#8953: a declared issue and one `run:add` put in are offered alike, side by side.
test('offers an added issue beside the declared ones, in the typed order', () => {
	const carry = { ...CARRY, added: [{ issue: 9, is_priority: false }] }
	const running = backlog_drive.initial_state(['9'], ACTIVE)
	const empty = backlog_drive.initial_state([], ACTIVE)

	expect(backlog_drive_named.offer(carry, running, true)).toMatchObject({ issues: ['1', '2'] })
	expect(backlog_drive_named.offer(carry, empty, true)).toMatchObject({ issues: ['1', '2', '9'] })
})

test('stops after all named issues when only mode is declared', () => {
	const carry = { ...CARRY, done: [1, 2] }
	const state = backlog_drive.initial_state([], ACTIVE)

	expect(backlog_drive_named.offer(carry, state, true)).toMatchObject({
		verdict: 'stop',
		is_finish: true,
	})
	expect(backlog_drive_named.offer(carry, state, false)).toBeUndefined()
})

// joshuafolkken/kit#3908: a child a person withdrew is as settled as a merged one, so the named run
// moves past it rather than waiting on an issue that will never merge.
test.each(['merged', 'withdrawn', 'human-review'] as const)(
	'records a named %s child under the separate supervisor PID',
	async (outcome) => {
		const directory = make_directory('josh-drive-named-')
		const target = run_carry.carry_path(directory)
		const read_directory = vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)
		const supervisor = spawn('sleep', ['30'])

		run_carry.begin_carry(target, CARRY.invocation, run_carry.owner_of(supervisor.pid ?? 0))

		await backlog_drive_named.mark_done(
			'1',
			{ outcome, code: 0, token: 'none', is_offer: true },
			String(supervisor.pid),
		)
		expect(run_carry.read_carry(target)).toMatchObject({ kind: 'carried', carry: { done: [1] } })
		supervisor.kill()
		read_directory.mockRestore()
	},
)

test.each([run_event_stream.EVENT_KIND.MERGE, run_event_stream.EVENT_KIND.HUMAN_REVIEW])(
	'recovers a named %s from the event stream after an interrupted handoff',
	async (kind) => {
		const directory = make_directory('josh-drive-reconcile-')
		const target = run_carry.carry_path(directory)
		const read_directory = vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)
		const carry = run_carry.begin_carry(target, CARRY.invocation, run_carry.owner_of(process.pid))
		if (carry === undefined) throw new Error('carry not created')
		const events = [{ pos: 1, kind, text: '#1 settled', at: ACTIVE }]

		await backlog_drive_named.reconcile(carry, events, String(process.pid))
		expect(run_carry.read_carry(target)).toMatchObject({ kind: 'carried', carry: { done: [1] } })
		read_directory.mockRestore()
	},
)

// An offer's `stop` passed through the merge is not the failure guard (joshuafolkken/kit#3781): the
// failed child is settled like any other, and only the control `stop` leaves it unmarked.
const FAILED_RESULTS: ReadonlyArray<[string, MergeResult, ReadonlyArray<number>]> = [
	['an offered child', { outcome: 'failed', code: 0, token: 'none', is_offer: true }, [1]],
	['an offer stop', { outcome: 'failed', code: 0, token: 'stop', is_offer: true }, [1]],
	[
		'no named issue after the control stop',
		{ outcome: 'failed', code: 0, token: 'stop', is_offer: false },
		[],
	],
]

test.each(FAILED_RESULTS)('marks %s after a failed first issue', async (_label, result, done) => {
	const directory = make_directory('josh-drive-failed-')
	const target = run_carry.carry_path(directory)
	const read_directory = vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)

	run_carry.begin_carry(target, CARRY.invocation, run_carry.owner_of(process.pid))
	await backlog_drive_named.mark_done('1', result, String(process.pid))
	const read = run_carry.read_carry(target)

	expect(read.kind === 'carried' ? (read.carry.done ?? []) : undefined).toStrictEqual(done)
	read_directory.mockRestore()
})

async function done_after_failure(failed: string, is_priority: boolean): Promise<unknown> {
	const directory = make_directory('josh-drive-added-')
	const target = run_carry.carry_path(directory)
	const read_directory = vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)
	const carry = run_carry.begin_carry(target, CARRY.invocation, run_carry.owner_of(process.pid))

	if (carry !== undefined) run_carry_added.add_issues(target, carry, [{ issue: 5, is_priority }])
	await backlog_drive_named.mark_done(
		failed,
		{ outcome: 'failed', code: 0, token: 'none', is_offer: true },
		String(process.pid),
	)
	const read = run_carry.read_carry(target)

	read_directory.mockRestore()

	return read.kind === 'carried' ? read.carry.done : undefined
}

test('a failed added issue skips none of the declared list', async () => {
	expect(await done_after_failure('5', true)).toStrictEqual([5])
})

// joshuafolkken/kit#8953: the named issues run side by side, so a failed one skips none of the others.
test('a failed declared issue skips none of the other named issues', async () => {
	expect(await done_after_failure('1', false)).toStrictEqual([1])
})
