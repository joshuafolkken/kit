import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_wake } from './run-wake'
import { run_wake_loop, type DriveResult } from './run-wake-loop'
import { run_wake_loop_fixture } from './run-wake-loop-fixture'

const make_directory = temporary_directory()

// joshuafolkken/kit#7120. A `triage` hand-back wakes its session beside the driver, keeping the record,
// so lanes are collected and refilled while the session judges.

const { BESIDE_CALL, HANDED_OFF, INVOCATION, NOW, recorder } = run_wake_loop_fixture
const TRIAGE_MATERIAL = 'Driver result: triage'
const INTERVAL_MS = 5000
const NO_GAP_MS = 0
const scratch = { target: '' }

function triage_then_finish(): () => Promise<DriveResult> {
	const results: Array<DriveResult> = [{ kind: 'triage', material: TRIAGE_MATERIAL }]

	return vi.fn(async (): Promise<DriveResult> => results.shift() ?? { kind: 'finished' })
}

beforeEach(() => {
	scratch.target = path.join(make_directory('josh-run-wake-beside-test-'), 'wake.json')
	run_wake.write_wake(scratch.target, run_wake.fresh_wake(INVOCATION, NOW))
})

describe('run_wake_loop.run_loop — a triage woken beside the driver', () => {
	it('wakes the triage session without handing the record off', async () => {
		const scripted = recorder([HANDED_OFF, HANDED_OFF])
		const ports = { ...scripted.ports, drive: triage_then_finish() }

		const stop = await run_wake_loop.run_loop(scratch.target, ports, 0)

		expect(stop.reason).toBe('ended')
		expect(scripted.order).toStrictEqual([BESIDE_CALL])
		expect(scripted.materials).toStrictEqual([TRIAGE_MATERIAL])
		expect(scripted.handed).toStrictEqual([])
	})

	it('drives again on the next pass instead of waiting out a wake grace window', async () => {
		const scripted = recorder([HANDED_OFF, HANDED_OFF])
		const drive = triage_then_finish()

		await run_wake_loop.run_loop(scratch.target, { ...scripted.ports, drive }, 0)

		expect(drive).toHaveBeenCalledTimes(2)
		expect(run_wake.read_wake(scratch.target)?.attempts).toBeUndefined()
	})

	it('re-drives without the interval between passes', async () => {
		const scripted = recorder([HANDED_OFF, HANDED_OFF])
		const sleep = vi.fn(async () => {
			await Promise.resolve()
		})
		const ports = { ...scripted.ports, sleep, drive: triage_then_finish() }

		await run_wake_loop.run_loop(scratch.target, ports, INTERVAL_MS)

		expect(sleep).toHaveBeenNthCalledWith(1, NO_GAP_MS)
	})

	it('stops the run when the triage session cannot launch', async () => {
		const note = 'spawn claude ENOENT'
		const scripted = recorder([HANDED_OFF], { kind: 'failed', note })
		const ports = { ...scripted.ports, drive: triage_then_finish() }

		const stop = await run_wake_loop.run_loop(scratch.target, ports, 0)

		expect(stop).toStrictEqual({ reason: run_wake_loop.FAILED_REASON, note })
	})
})
