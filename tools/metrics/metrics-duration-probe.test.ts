import { spawnSync } from 'node:child_process'
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { run_carry } from '#scripts/run/carry/run-carry'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { metrics_duration_probe, type Measurement } from './metrics-duration-probe'
import type { Durations } from './metrics-durations'

vi.mock('node:child_process', async (original) => {
	const actual = await original<{ spawnSync: typeof spawnSync }>()

	return { ...actual, spawnSync: vi.fn(actual.spawnSync) }
})
vi.mock('node:fs', async (original) => {
	const actual = await original<{ renameSync: typeof renameSync }>()

	return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

const scratch = mkdtempSync(path.join(tmpdir(), 'metrics-duration-probe-test-'))
const baseline_file = path.join(scratch, 'durations.json')
const FAIL = 1
const WARNING = 'josh metrics: warning'
const GATE_BASELINE = '{"gate": 1000}'
const GATE_STARTUP_BASELINE = '{"gate": 1000, "josh_startup": 170}'
const BASELINE_NAME = 'metrics-durations.json'
const LEGACY_BASELINE_NAME = 'josh-metrics-durations.json'
const READ_ONLY_MODE = 0o555
const WRITABLE_MODE = 0o755

function quiet(durations: Durations): Measurement {
	return { durations, is_busy: false }
}

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

		expect(metrics_duration_probe.check(baseline_file, quiet({ gate: 1200 }))).toBe(FAIL)
		expect(baseline_on_disk()).toStrictEqual({ gate: 1000 })
	})

	it('passes the gate on a duration within the tolerance', () => {
		writeFileSync(baseline_file, GATE_BASELINE)

		expect(metrics_duration_probe.check(baseline_file, quiet({ gate: 1050 }))).toBe(0)
		expect(baseline_on_disk()).toStrictEqual({ gate: 1000 })
	})

	it('records the first measurement on a machine with no baseline yet', () => {
		expect(metrics_duration_probe.check(baseline_file, quiet({ josh_startup: 170.4 }))).toBe(0)
		expect(baseline_on_disk()).toStrictEqual({ josh_startup: 170 })
	})
})

// joshuafolkken/kit#4709: a slowdown measured while other lanes loaded the machine warns, not fails.
describe('metrics_duration_probe.check — a busy machine', () => {
	it('warns and passes on a duration past the tolerance measured while the machine was busy', () => {
		writeFileSync(baseline_file, GATE_BASELINE)

		expect(
			metrics_duration_probe.check(baseline_file, { durations: { gate: 1200 }, is_busy: true }),
		).toBe(0)
		expect(vi.mocked(process.stderr.write)).toHaveBeenCalledWith(expect.stringContaining(WARNING))
		expect(baseline_on_disk()).toStrictEqual({ gate: 1000 })
	})

	it('still fails the same duration measured on a quiet machine', () => {
		writeFileSync(baseline_file, GATE_BASELINE)

		expect(metrics_duration_probe.check(baseline_file, quiet({ gate: 1200 }))).toBe(FAIL)
		expect(vi.mocked(process.stderr.write)).not.toHaveBeenCalledWith(
			expect.stringContaining(WARNING),
		)
	})

	it('still fails a startup timed at the check on a busy interval', () => {
		writeFileSync(baseline_file, GATE_STARTUP_BASELINE)

		const measurement = { durations: { gate: 1200, josh_startup: 340 }, is_busy: true }

		expect(metrics_duration_probe.check(baseline_file, measurement)).toBe(FAIL)
		expect(vi.mocked(process.stderr.write)).toHaveBeenCalledWith(expect.stringContaining(WARNING))
	})
})

describe('metrics_duration_probe.accept', () => {
	it('replaces what it measured and keeps the bar of what it did not', () => {
		writeFileSync(baseline_file, GATE_STARTUP_BASELINE)

		metrics_duration_probe.accept(baseline_file, { gate: undefined, josh_startup: 190 })

		expect(baseline_on_disk()).toStrictEqual({ gate: 1000, josh_startup: 190 })
	})
})

// joshuafolkken/kit#4653: josh's state sits in its own directory of the common one, not at its root.
describe('metrics_duration_probe.baseline_path', () => {
	it('keeps the baseline in the josh state directory of the common git directory', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(path.join(scratch, '.git'))

		expect(await metrics_duration_probe.baseline_path()).toBe(
			path.join(scratch, '.git', 'josh', BASELINE_NAME),
		)
	})

	it('creates the josh state directory when it records the first baseline', () => {
		const nested = path.join(scratch, 'fresh', 'josh', BASELINE_NAME)

		expect(metrics_duration_probe.check(nested, quiet({ josh_startup: 170 }))).toBe(0)
		expect(JSON.parse(readFileSync(nested, 'utf8'))).toStrictEqual({ josh_startup: 170 })
	})

	it('moves the baseline kept at the common directory root into the josh state directory', async () => {
		const repository = mkdtempSync(path.join(scratch, 'legacy-'))

		writeFileSync(path.join(repository, LEGACY_BASELINE_NAME), GATE_BASELINE)
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(repository)

		const file = await metrics_duration_probe.baseline_path()

		expect(file === undefined ? undefined : readFileSync(file, 'utf8')).toBe(GATE_BASELINE)
		expect(existsSync(path.join(repository, LEGACY_BASELINE_NAME))).toBe(false)
	})

	it('copies the root baseline when the root is read-only', async () => {
		const repository = mkdtempSync(path.join(scratch, 'sandboxed-'))

		writeFileSync(path.join(repository, LEGACY_BASELINE_NAME), GATE_BASELINE)
		mkdirSync(path.join(repository, 'josh'))
		chmodSync(repository, READ_ONLY_MODE)
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(repository)

		const file = await metrics_duration_probe.baseline_path()

		chmodSync(repository, WRITABLE_MODE)
		expect(file === undefined ? undefined : readFileSync(file, 'utf8')).toBe(GATE_BASELINE)
	})
})

// Two lanes' gates both see the root baseline; the one whose move loses finds it already gone.
describe('metrics_duration_probe.baseline_path under a concurrent move', () => {
	// The move fails and the other lane's move lands before the copy, so the copy finds nothing.
	it('takes the baseline another lane moved first rather than failing to copy it', async () => {
		const repository = mkdtempSync(path.join(scratch, 'raced-'))

		writeFileSync(path.join(repository, LEGACY_BASELINE_NAME), GATE_BASELINE)
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(repository)
		vi.mocked(renameSync).mockImplementationOnce((from, to) => {
			writeFileSync(to, GATE_BASELINE)
			rmSync(from)
			throw new Error('ENOENT: the other lane moved it first')
		})

		const file = await metrics_duration_probe.baseline_path()

		expect(file === undefined ? undefined : readFileSync(file, 'utf8')).toBe(GATE_BASELINE)
	})
})

describe('metrics_duration_probe.measure', () => {
	it('holds a startup that ran past the timeout at the timeout instead of leaving it unmeasured', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValue(undefined)
		// A real run killed at a 1 ms timeout, handed back for every startup the probe times.
		vi.mocked(spawnSync).mockReturnValue(spawnSync('sleep', ['1'], { timeout: 1 }))

		const { durations } = await metrics_duration_probe.measure(scratch, true)

		expect(durations.josh_startup).toBeGreaterThanOrEqual(PROBE_TIMEOUT_MS)
		expect(durations.guard_startup).toBeGreaterThanOrEqual(PROBE_TIMEOUT_MS)
	})
})

// The five solo gates of joshuafolkken/kit#4695 at 10.5s, each quiet at its two ends, and the lane
// driver's minute-by-minute samples through them with six lanes at work.
function lane_4695_ledger(file: string): void {
	const gates = [0, 10, 20, 30, 40].map((minute) => ({
		kind: 'gate',
		at: `2026-10-23T13:${String(minute).padStart(2, '0')}:30Z`,
		elapsed_ms: 10_500,
		is_passed: true,
		unit_ms: 1500,
		external_cores: 0,
	}))
	const loads = Array.from({ length: 41 }, (_, minute) => ({
		kind: 'load',
		at: `2026-10-23T13:${String(minute).padStart(2, '0')}:00Z`,
		load: 4.8,
		lanes: 6,
	}))

	writeFileSync(file, `${[...gates, ...loads].map((entry) => JSON.stringify(entry)).join('\n')}\n`)
}

describe('metrics_duration_probe.measure and check — the #4695 gate', () => {
	it('passes gate 7.1s → 10.5s measured while other lanes worked', async () => {
		const ledger = path.join(scratch, 'ledger.jsonl')

		lane_4695_ledger(ledger)
		writeFileSync(baseline_file, '{"gate": 7100, "unit": 1100}')
		vi.spyOn(lane_ledger, 'target').mockResolvedValue(ledger)

		const measurement = await metrics_duration_probe.measure(scratch, false)

		expect(measurement).toStrictEqual({ durations: { gate: 10_500, unit: 1500 }, is_busy: true })
		expect(metrics_duration_probe.check(baseline_file, measurement)).toBe(0)
	})
})
