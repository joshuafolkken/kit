import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { josh_command } from '#scripts/josh/josh-run'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_wake_driver } from './run-wake-driver'

const INVOCATION = 'backlogrun #2509 --max 5 --only'
const OUTPUT = 'merge over #2509\nresume: --owner 1 --exclude 2509'
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
		material: `Driver result: ${OUTPUT}\nDetails: budget spent`,
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

test('refuses an incomplete driver result without waking an agent', () => {
	expect(run_wake_driver.driver_result('', { kind: 'none' })).toMatchObject({ kind: 'failed' })
})

test('does not take a live owner over on supervisor restart', async () => {
	run_carry.end_carry(scratch.target)
	run_carry.begin_carry(scratch.target, INVOCATION, run_carry.owner_of(process.pid))
	const subprocess = vi.spyOn(josh_command, 'josh_run')

	expect(await run_wake_driver.drive(scratch.target)).toMatchObject({ kind: 'failed' })
	expect(subprocess).not.toHaveBeenCalled()
})
