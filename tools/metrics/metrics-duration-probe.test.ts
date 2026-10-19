import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { metrics_duration_probe } from './metrics-duration-probe'

vi.mock('node:child_process', async (original) => {
	const actual = await original<{ spawnSync: typeof spawnSync }>()

	return { ...actual, spawnSync: vi.fn(actual.spawnSync) }
})

const scratch = mkdtempSync(path.join(tmpdir(), 'metrics-duration-probe-test-'))
const baseline_file = path.join(scratch, 'durations.json')
const FAIL = 1
const GATE_BASELINE = '{"gate": 1000}'

function baseline_on_disk(): unknown {
	return JSON.parse(readFileSync(baseline_file, 'utf8'))
}

beforeEach(() => {
	rmSync(baseline_file, { force: true })
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

// joshuafolkken/kit#3409: the gate fails past the +10% tolerance and passes within it.
describe('metrics_duration_probe.check', () => {
	it('fails the gate on a duration past the tolerance and leaves the baseline alone', () => {
		writeFileSync(baseline_file, GATE_BASELINE)

		expect(metrics_duration_probe.check(baseline_file, { gate: 1200 })).toBe(FAIL)
		expect(baseline_on_disk()).toStrictEqual({ gate: 1000 })
	})

	it('passes the gate on a duration within the tolerance', () => {
		writeFileSync(baseline_file, GATE_BASELINE)

		expect(metrics_duration_probe.check(baseline_file, { gate: 1050 })).toBe(0)
		expect(baseline_on_disk()).toStrictEqual({ gate: 1000 })
	})

	it('records the first measurement on a machine with no baseline yet', () => {
		expect(metrics_duration_probe.check(baseline_file, { josh_startup: 170.4 })).toBe(0)
		expect(baseline_on_disk()).toStrictEqual({ josh_startup: 170 })
	})
})

describe('metrics_duration_probe.accept', () => {
	it('replaces what it measured and keeps the bar of what it did not', () => {
		writeFileSync(baseline_file, '{"gate": 1000, "josh_startup": 170}')

		metrics_duration_probe.accept(baseline_file, { gate: undefined, josh_startup: 190 })

		expect(baseline_on_disk()).toStrictEqual({ gate: 1000, josh_startup: 190 })
	})
})

describe('metrics_duration_probe.measure', () => {
	it('holds a startup that ran past the timeout at the timeout instead of leaving it unmeasured', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValue(undefined)
		// A real run killed at a 1 ms timeout, handed back for every startup the probe times.
		vi.mocked(spawnSync).mockReturnValue(spawnSync('sleep', ['1'], { timeout: 1 }))

		const durations = await metrics_duration_probe.measure(scratch, true)

		expect(durations.josh_startup).toBeGreaterThanOrEqual(PROBE_TIMEOUT_MS)
		expect(durations.guard_startup).toBeGreaterThanOrEqual(PROBE_TIMEOUT_MS)
	})
})
