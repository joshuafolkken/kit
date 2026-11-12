import path from 'node:path'
import { josh_command } from '#scripts/josh/josh-run'
import { process_identity } from '#scripts/josh/process-identity'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { run_wake_driver } from './run-wake-driver'
import { run_wake_resume } from './run-wake-resume'

const make_directory = temporary_directory()

const INVOCATION = 'backlogrun #2509 --max 5 --only'
const STARTED = new Date('2026-11-07T00:00:00.000Z')
const LATER = new Date('2026-11-07T01:00:00.000Z')
const PARKED = 'merge over #2509\nresume: --owner 1 --exclude 2508'
const SETTLED = 'merge over #2509\nresume: --owner 1'
const TRIAGE_PID = 4242
const TRIAGE_START = 'Tue Nov 10 09:00:00 2026'
const scratch = { target: '' }

beforeEach(() => {
	scratch.target = path.join(make_directory('josh-wake-resume-'), 'carry.json')
	run_carry.begin_carry(scratch.target, INVOCATION, run_carry.NO_OWNER, STARTED)
	vi.spyOn(run_event_setup, 'emit').mockResolvedValue()
})

afterEach(() => {
	vi.restoreAllMocks()
})

async function no_pause(): Promise<void> {
	await Promise.resolve()
}

function driver_returns(...outs: ReadonlyArray<string>): ReturnType<typeof vi.spyOn> {
	const subprocess = vi.spyOn(josh_command, 'josh_run')

	for (const out of outs) subprocess.mockResolvedValueOnce({ code: 0, out })

	return subprocess
}

function args_of(subprocess: ReturnType<typeof vi.spyOn>, call: number): ReadonlyArray<string> {
	return subprocess.mock.calls[call]?.[0] as ReadonlyArray<string>
}

test('re-drives a busy verdict from the state the driver left, as this supervisor', async () => {
	const subprocess = driver_returns('merge busy #2509\nresume: --owner 1 --exclude 2508', SETTLED)

	await run_wake_driver.drive(scratch.target, no_pause)

	expect(args_of(subprocess, 1)).toStrictEqual([
		...(run_wake_driver.driver_args(INVOCATION) ?? []),
		'--exclude',
		'2508',
	])
})

test('starts the pass after a hand-back from the state the last driver run left', async () => {
	const subprocess = driver_returns(PARKED, SETTLED)

	expect(await run_wake_driver.drive(scratch.target)).toMatchObject({ kind: 'judgment' })
	await run_wake_driver.drive(scratch.target)

	expect(args_of(subprocess, 1)).toContain('2508')
	expect(args_of(subprocess, 1)).toContain('--only')
})

test('re-drives a busy verdict with the parked-child triage still owed', async () => {
	const subprocess = driver_returns('merge busy #2509\nresume: --owner 1 --triage-owed', SETTLED)

	await run_wake_driver.drive(scratch.target, no_pause)

	expect(args_of(subprocess, 1)).toContain('--triage-owed')
})

test('drives the pass after a triage with the triage session named on the kept line', async () => {
	const subprocess = driver_returns('triage\nresume: --owner 1 --exclude 2508', SETTLED)

	vi.spyOn(process_identity, 'read_start').mockReturnValue(TRIAGE_START)

	expect(await run_wake_driver.drive(scratch.target)).toMatchObject({ kind: 'triage' })
	const read = run_carry.read_carry(scratch.target)
	if (read.kind === 'carried') run_wake_resume.name_beside(scratch.target, read.carry, TRIAGE_PID)
	await run_wake_driver.drive(scratch.target)

	expect(args_of(subprocess, 1).slice(-6)).toStrictEqual([
		'--exclude',
		'2508',
		'--triage-pid',
		String(TRIAGE_PID),
		'--triage-start',
		'Tue_Nov_10_09:00:00_2026',
	])
})

test('restarts the idle watch rather than carrying the last activity into the next pass', async () => {
	const subprocess = driver_returns(
		'merge over #2509\nresume: --owner 1 --active 2026-11-07T00:00:00.000Z --exclude 2508',
		SETTLED,
	)

	await run_wake_driver.drive(scratch.target)
	await run_wake_driver.drive(scratch.target)

	expect(args_of(subprocess, 1)).not.toContain('--active')
	expect(args_of(subprocess, 1)).toContain('2508')
})

test('does not replay a state a later driver run consumed', async () => {
	const subprocess = driver_returns(PARKED, SETTLED, SETTLED)

	await run_wake_driver.drive(scratch.target)
	await run_wake_driver.drive(scratch.target)
	await run_wake_driver.drive(scratch.target)

	expect(args_of(subprocess, 2)).toStrictEqual(run_wake_driver.driver_args(INVOCATION))
})

test.each([
	['a later run of the same invocation', INVOCATION],
	['another invocation', 'backlogrun --max 3'],
])('does not hand the kept state to %s', async (_label, invocation) => {
	const subprocess = driver_returns(PARKED, SETTLED)

	await run_wake_driver.drive(scratch.target)
	run_carry.end_carry(scratch.target)
	run_carry.begin_carry(scratch.target, invocation, run_carry.NO_OWNER, LATER)
	await run_wake_driver.drive(scratch.target)

	expect(args_of(subprocess, 1)).not.toContain('2508')
})

test.each([
	['an owner', 'merge over #2509\nresume: --exclude 2508'],
	['a valid budget', 'merge over #2509\nresume: --owner 1 --max many'],
])('refuses a resume line without %s', async (_label, out) => {
	driver_returns(out)

	expect(await run_wake_driver.drive(scratch.target)).toMatchObject({
		kind: 'failed',
		note: expect.stringContaining('invalid resume line') as unknown,
	})
})

test('refuses a busy result whose resume line is invalid instead of re-driving it', async () => {
	const subprocess = driver_returns('merge busy #2509\nresume: --exclude 2508')

	expect(await run_wake_driver.drive(scratch.target, no_pause)).toMatchObject({ kind: 'failed' })
	expect(subprocess).toHaveBeenCalledOnce()
})

test('fails the next pass when the kept resume line no longer parses', async () => {
	const subprocess = driver_returns('merge over #2509\nresume: --owner 1 --idle never')

	await run_wake_driver.drive(scratch.target)

	expect(await run_wake_driver.drive(scratch.target)).toStrictEqual({
		kind: 'failed',
		note: 'The kept driver resume line is invalid.',
	})
	expect(subprocess).toHaveBeenCalledOnce()
})
