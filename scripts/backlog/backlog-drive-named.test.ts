import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_carry_added } from '#scripts/run/carry/run-carry-added'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { expect, test, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_named } from './backlog-drive-named'

const ACTIVE = '2026-09-24T00:00:00.000Z'
const CARRY = {
	invocation: 'backlogrun #1 #2 --only',
	started_at: ACTIVE,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

test('dispatches named issues in order and waits for the first one in flight', () => {
	const empty = backlog_drive.initial_state([], ACTIVE)
	const running = backlog_drive.initial_state(['1'], ACTIVE)

	expect(backlog_drive_named.offer(CARRY, empty, true)).toMatchObject({
		verdict: 'run',
		issues: ['1'],
	})
	expect(backlog_drive_named.offer(CARRY, running, true)?.verdict).toBe('wait')
})

// joshuafolkken/kit#3558: a `run:add`ed issue in flight at the head held the named epic behind it, so
// a child filed into the epic waited for a parent session.
test('offers the declared item past an added issue already in flight', () => {
	const carry = { ...CARRY, added: [{ issue: 9, is_priority: true }] }
	const running = backlog_drive.initial_state(['9'], ACTIVE)
	const declared = backlog_drive.initial_state(['1'], ACTIVE)

	expect(backlog_drive_named.offer(carry, running, true)).toMatchObject({
		verdict: 'run',
		issues: ['1'],
	})
	expect(backlog_drive_named.offer(carry, declared, true)?.verdict).toBe('run')
	expect(backlog_drive_named.offer(CARRY, declared, true)?.verdict).toBe('wait')
})

// joshuafolkken/kit#4206: the issue a held one starts after, as `run:board` names it on the queued row.
test('names the declared issue just before one the declared order holds', () => {
	const carry = {
		...CARRY,
		invocation: 'backlogrun #1 #2 #3 --only',
		added: [{ issue: 9, is_priority: false }],
	}

	expect(backlog_drive_named.held_after(carry, ['1'], 2)).toBe(1)
	expect(backlog_drive_named.held_after(carry, ['1'], 3)).toBe(2)
	expect(backlog_drive_named.held_after(carry, ['1'], 9)).toBeUndefined()
	expect(backlog_drive_named.held_after(carry, ['1'], 1)).toBeUndefined()
})

// joshuafolkken/kit#4279: before the first declared issue started, the one after it said nothing.
test('holds the declared order before its first issue starts, and never an issue in flight', () => {
	expect(backlog_drive_named.held_after(CARRY, [], 2)).toBe(1)
	expect(backlog_drive_named.held_after(CARRY, [], 1)).toBeUndefined()
	expect(backlog_drive_named.held_after(CARRY, ['2'], 2)).toBeUndefined()
	const unnamed = { ...CARRY, invocation: 'backlogrun' }

	expect(backlog_drive_named.held_after(unnamed, ['1'], 2)).toBeUndefined()
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
test.each(['merged', 'withdrawn'] as const)(
	'records a named %s child under the separate supervisor PID',
	async (outcome) => {
		const directory = mkdtempSync(path.join(tmpdir(), 'josh-drive-named-'))
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
		rmSync(directory, { recursive: true, force: true })
	},
)

test('recovers a named merge from the event stream after an interrupted handoff', async () => {
	const directory = mkdtempSync(path.join(tmpdir(), 'josh-drive-reconcile-'))
	const target = run_carry.carry_path(directory)
	const read_directory = vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)
	const carry = run_carry.begin_carry(target, CARRY.invocation, run_carry.owner_of(process.pid))
	if (carry === undefined) throw new Error('carry not created')
	const events = [
		{ pos: 1, kind: run_event_stream.EVENT_KIND.MERGE, text: '#1 merged', at: ACTIVE },
	]

	await backlog_drive_named.reconcile(carry, events, String(process.pid))
	expect(run_carry.read_carry(target)).toMatchObject({ kind: 'carried', carry: { done: [1] } })
	read_directory.mockRestore()
	rmSync(directory, { recursive: true, force: true })
})

// An offer's `stop` passed through the merge is not the failure guard (joshuafolkken/kit#3781): the
// failed child is settled like any other, and only the control `stop` leaves it unmarked.
const FAILED_RESULTS: ReadonlyArray<[string, MergeResult, ReadonlyArray<number>]> = [
	['an offered child', { outcome: 'failed', code: 0, token: 'none', is_offer: true }, [1, 2]],
	['an offer stop', { outcome: 'failed', code: 0, token: 'stop', is_offer: true }, [1, 2]],
	[
		'no named issue after the control stop',
		{ outcome: 'failed', code: 0, token: 'stop', is_offer: false },
		[],
	],
]

test.each(FAILED_RESULTS)('marks %s after a failed first issue', async (_label, result, done) => {
	const directory = mkdtempSync(path.join(tmpdir(), 'josh-drive-failed-'))
	const target = run_carry.carry_path(directory)
	const read_directory = vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)

	run_carry.begin_carry(target, CARRY.invocation, run_carry.owner_of(process.pid))
	await backlog_drive_named.mark_done('1', result, String(process.pid))
	const read = run_carry.read_carry(target)

	expect(read.kind === 'carried' ? (read.carry.done ?? []) : undefined).toStrictEqual(done)
	read_directory.mockRestore()
	rmSync(directory, { recursive: true, force: true })
})

async function done_after_failure(failed: string, is_priority: boolean): Promise<unknown> {
	const directory = mkdtempSync(path.join(tmpdir(), 'josh-drive-added-'))
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
	rmSync(directory, { recursive: true, force: true })

	return read.kind === 'carried' ? read.carry.done : undefined
}

test('a failed added issue skips none of the declared list', async () => {
	expect(await done_after_failure('5', true)).toStrictEqual([5])
})

test('a failed declared issue skips the declared issues after it but not an added one', async () => {
	expect(await done_after_failure('1', false)).toStrictEqual([1, 2])
})
