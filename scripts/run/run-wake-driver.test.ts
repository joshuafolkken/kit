import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { josh_command } from '#scripts/josh/josh-run'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_wake_driver } from './run-wake-driver'

const INVOCATION = 'backlogrun #2509 --max 5 --only'
const OUTPUT = 'merge over #2509\nresume: --owner 1 --exclude 2509'
const LONG_STDERR_REPEAT = 1000
const EPIC_OUTPUT = 'epic #1\nresume: --owner 1'
const CUT_COMMAND = 'pnpm josh run:carry --cut --owner "$PPID"'
const CLAIM_COMMAND = `pnpm josh run:carry --resume "${INVOCATION}" --owner "$PPID"`
const DEFAULT_NEXT = `first claim the carry record with ${CLAIM_COMMAND}, then act on the result by backlogrun-steps.md → "The loop", then hand the loop back with ${CUT_COMMAND}`
const scratch = { directory: '', target: '' }

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-wake-driver-'))
	scratch.target = path.join(scratch.directory, 'carry.json')
	run_carry.begin_carry(scratch.target, INVOCATION, run_carry.NO_OWNER, new Date())
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(scratch.directory, { recursive: true, force: true })
})

test('passes validated budget flags to the driver and leaves named issues in the carry record', () => {
	expect(run_wake_driver.driver_args(INVOCATION)).toStrictEqual([
		'backlog:drive',
		'--owner',
		String(process.pid),
		'--max',
		'5',
		'--only',
	])
	expect(run_wake_driver.driver_args('backlogrun #2509 --evil')).toBeUndefined()
})

test('claims the carry record and supplies a judgment branch with its resume material', async () => {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({
		code: 0,
		out: OUTPUT,
		err: 'budget spent',
	})

	const result = await run_wake_driver.drive(scratch.target)

	expect(result).toStrictEqual({
		kind: 'judgment',
		material: `Driver result: ${OUTPUT}\nNext: ${DEFAULT_NEXT}\nDetails: budget spent`,
	})
	expect(run_carry.read_carry(scratch.target)).toMatchObject({
		kind: 'carried',
		carry: { owner_pid: process.pid, is_handed_off: false },
	})
})

test('finishes without a judgment when the driver ends the carry record', async () => {
	vi.spyOn(josh_command, 'josh_run').mockImplementation(async () => {
		run_carry.end_carry(scratch.target)

		return { code: 0, out: 'stop\nresume: --owner 1' }
	})

	expect(await run_wake_driver.drive(scratch.target)).toStrictEqual({ kind: 'finished' })
})

test('hands on only the tail of a long stderr, after the verdict, resume line and epic note', () => {
	const result = run_wake_driver.driver_result(
		EPIC_OUTPUT,
		{ kind: 'none' },
		INVOCATION,
		`${'early output\n'.repeat(LONG_STDERR_REPEAT)}why it stopped`,
	)

	expect(result.kind).toBe('judgment')
	if (result.kind !== 'judgment') return
	expect(result.material.length).toBeLessThan(agent_role_profile.MAX_VALUE_LENGTH)
	expect(result.material).toMatch(
		/^Driver result: epic #1\nresume: --owner 1\nThe named item is an epic/u,
	)
	expect(result.material.endsWith('why it stopped')).toBe(true)
})

test('leads a failed drive note with the driver stdout error line, then the stderr tail', async () => {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({
		code: 1,
		out: 'launch #3234\nerror spawn git ENOENT',
		err: `${'early output\n'.repeat(LONG_STDERR_REPEAT)}[ELIFECYCLE] Command failed`,
	})

	const result = await run_wake_driver.drive(scratch.target)

	expect(result.kind).toBe('failed')
	if (result.kind !== 'failed') return
	expect(result.note).toMatch(/^error spawn git ENOENT\n\.\.\. /u)
	expect(result.note.endsWith('[ELIFECYCLE] Command failed')).toBe(true)
	expect(result.note.length).toBeLessThan(agent_role_profile.MAX_VALUE_LENGTH)
})

test('falls back to the driver stdout when a failed drive printed no error line', async () => {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 1, out: 'stop', err: '' })

	expect(await run_wake_driver.drive(scratch.target)).toStrictEqual({
		kind: 'failed',
		note: 'stop',
	})
})

test('refuses an incomplete driver result without waking an agent', () => {
	expect(run_wake_driver.driver_result('', { kind: 'none' }, INVOCATION)).toMatchObject({
		kind: 'failed',
	})
})

test('tells an epic judgment session how to advance the named carry', () => {
	const result = run_wake_driver.driver_result(EPIC_OUTPUT, { kind: 'none' }, INVOCATION)

	expect(result).toMatchObject({ kind: 'judgment' })
	if (result.kind !== 'judgment') return
	expect(result.material).toContain('run:carry --done <epic-number> --owner "$PPID"')
	expect(result.material).toContain('Follow backlogrun-steps.md named epic procedure')
})

test.each([
	['launch #2500\nresume: --owner 1', CUT_COMMAND],
	['retrospective\nresume: --owner 1', 'pnpm josh run:carry --retrospective --summary'],
	['merge human-review #2500\nresume: --owner 1', 'needs-human-review.md'],
	[EPIC_OUTPUT, 'Named issues run first, in order'],
])('claims the carry record, then names the next move for a judgment branch: %j', (out, next) => {
	const result = run_wake_driver.driver_result(out, { kind: 'none' }, INVOCATION)

	expect(result.kind).toBe('judgment')
	if (result.kind !== 'judgment') return
	expect(result.material).toContain(
		`\nNext: first claim the carry record with ${CLAIM_COMMAND}, then `,
	)
	expect(result.material.slice(result.material.indexOf('\nNext: '))).toContain(next)
})

test('builds the claim command the standing refusal also prints', () => {
	expect(run_carry.claim_command(INVOCATION)).toBe(CLAIM_COMMAND)
})

test('does not take a live owner over on supervisor restart', async () => {
	run_carry.end_carry(scratch.target)
	run_carry.begin_carry(scratch.target, INVOCATION, run_carry.owner_of(process.pid))
	const subprocess = vi.spyOn(josh_command, 'josh_run')

	expect(await run_wake_driver.drive(scratch.target)).toMatchObject({ kind: 'failed' })
	expect(subprocess).not.toHaveBeenCalled()
})
