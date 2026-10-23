import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_wake } from './run-wake'
import { run_wake_loop } from './run-wake-loop'
import { run_wake_loop_fixture } from './run-wake-loop-fixture'

// joshuafolkken/kit#4509: the supervisor reloads its code at a pass boundary, before it drives or
// launches anything for that pass.

const { ENDED, HANDED_OFF, IN_FLIGHT, INVOCATION, NOW, recorder } = run_wake_loop_fixture
const scratch = { directory: '', target: '' }

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-run-wake-loop-reload-test-'))
	scratch.target = path.join(scratch.directory, 'wake.json')
	run_wake.write_wake(scratch.target, run_wake.fresh_wake(INVOCATION, NOW))
})

afterEach(() => {
	rmSync(scratch.directory, { force: true, recursive: true })
})

describe('run_wake_loop.run_loop — reloading on new code', () => {
	it('stops for a reload before driving when the code is stale', async () => {
		const drive = vi.fn(async () => ({ kind: 'finished' as const }))
		const ports = { ...recorder([HANDED_OFF]).ports, drive, is_code_stale: async () => true }

		const stop = await run_wake_loop.run_loop(scratch.target, ports, 0)

		expect(stop).toStrictEqual({ reason: run_wake_loop.RELOAD_REASON, note: undefined })
		expect(drive).not.toHaveBeenCalled()
	})

	it('reloads at the first pass that finds the code stale', async () => {
		const answers = [false, true]
		const is_code_stale = vi.fn(async () => answers.shift() ?? false)
		const scripted = recorder([IN_FLIGHT, IN_FLIGHT])

		const stop = await run_wake_loop.run_loop(
			scratch.target,
			{ ...scripted.ports, is_code_stale },
			0,
		)

		expect(stop.reason).toBe(run_wake_loop.RELOAD_REASON)
		expect(is_code_stale).toHaveBeenCalledTimes(2)
	})
})

describe('run_wake_loop.run_loop — a stop wins over a reload', () => {
	it('ends the run rather than reloading when the carry record ended', async () => {
		const is_code_stale = vi.fn(async () => true)

		const stop = await run_wake_loop.run_loop(
			scratch.target,
			{ ...recorder([ENDED]).ports, is_code_stale },
			0,
		)

		expect(stop.reason).toBe('ended')
		expect(is_code_stale).not.toHaveBeenCalled()
	})

	it('stops without checking the code when the wake record is gone', async () => {
		const is_code_stale = vi.fn(async () => true)

		rmSync(scratch.target, { force: true })

		const stop = await run_wake_loop.run_loop(
			scratch.target,
			{ ...recorder([HANDED_OFF]).ports, is_code_stale },
			0,
		)

		expect(stop.reason).toBe('stopped')
		expect(is_code_stale).not.toHaveBeenCalled()
	})
})
