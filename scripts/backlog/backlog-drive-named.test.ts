import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_carry } from '#scripts/run/run-carry'
import { run_event_stream } from '#scripts/run/run-event-stream'
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

test('stops after all named issues when only mode is declared', () => {
	const carry = { ...CARRY, done: [1, 2] }
	const state = backlog_drive.initial_state([], ACTIVE)

	expect(backlog_drive_named.offer(carry, state, true)).toMatchObject({
		verdict: 'stop',
		is_finish: true,
	})
	expect(backlog_drive_named.offer(carry, state, false)).toBeUndefined()
})

test('records a named merge under the separate supervisor PID', async () => {
	const directory = mkdtempSync(path.join(tmpdir(), 'josh-drive-named-'))
	const target = run_carry.carry_path(directory)
	const read_directory = vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)
	const supervisor = spawn('sleep', ['30'])

	run_carry.begin_carry(target, CARRY.invocation, run_carry.owner_of(supervisor.pid ?? 0))

	await backlog_drive_named.mark_done(
		'1',
		{ outcome: 'merged', code: 0, token: 'none' },
		String(supervisor.pid),
	)
	expect(run_carry.read_carry(target)).toMatchObject({ kind: 'carried', carry: { done: [1] } })
	supervisor.kill()
	read_directory.mockRestore()
	rmSync(directory, { recursive: true, force: true })
})

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

test('skips later named issues after a failed first issue', async () => {
	const directory = mkdtempSync(path.join(tmpdir(), 'josh-drive-failed-'))
	const target = run_carry.carry_path(directory)
	const read_directory = vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)

	run_carry.begin_carry(target, CARRY.invocation, run_carry.owner_of(process.pid))
	await backlog_drive_named.mark_done(
		'1',
		{ outcome: 'failed', code: 0, token: 'none' },
		String(process.pid),
	)
	expect(run_carry.read_carry(target)).toMatchObject({ kind: 'carried', carry: { done: [1, 2] } })
	read_directory.mockRestore()
	rmSync(directory, { recursive: true, force: true })
})
