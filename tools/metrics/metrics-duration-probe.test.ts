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
import { metrics_duration_probe } from './metrics-duration-probe'

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
const GATE_BASELINE = '{"gate": 1000}'
const BASELINE_NAME = 'metrics-durations.json'
const LEGACY_BASELINE_NAME = 'josh-metrics-durations.json'
const READ_ONLY_MODE = 0o555
const WRITABLE_MODE = 0o755

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

		expect(metrics_duration_probe.check(nested, { josh_startup: 170 })).toBe(0)
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

		const durations = await metrics_duration_probe.measure(scratch, true)

		expect(durations.josh_startup).toBeGreaterThanOrEqual(PROBE_TIMEOUT_MS)
		expect(durations.guard_startup).toBeGreaterThanOrEqual(PROBE_TIMEOUT_MS)
	})
})
