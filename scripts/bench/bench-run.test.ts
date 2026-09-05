import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { review_stamps } from '#scripts/review/review-stamps'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bench_guard } from './bench-guard'
import type { BenchSample } from './bench-report'
import { bench_run } from './bench-run'
import { bench_targets, type BenchTarget } from './bench-targets'

const LINT = 'lint'
const ESLINT_CACHE = '.eslintcache'
const TRACKED_FILE = 'package.json'

function fixture_root(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'bench-run-'))

	writeFileSync(path.join(root, ESLINT_CACHE), 'cache')
	writeFileSync(path.join(root, TRACKED_FILE), '{}')

	return root
}

function mark_gate_running(): void {
	vi.spyOn(review_stamps.in_flight_stamp, 'read').mockReturnValue({
		taken_at: new Date().toISOString(),
		files: {},
		pid: process.pid,
	})
}

// A sample that took one reading, which is what `residue_notes` asks about: a cleared cache is a
// cache some cycle of this target removed.
function measured_sample(): BenchSample {
	return {
		target: LINT,
		caches: [ESLINT_CACHE],
		readings: [{ cold_ms: 1000, warm_ms: 100, is_failed: false }],
	}
}

function lint_target(): BenchTarget {
	const target = bench_targets.find_target(LINT)

	expect(target).toBeDefined()

	return target ?? { name: LINT, caches: [], flags: [] }
}

describe('bench run — what a cold reading removes', () => {
	it('removes the cache the target declares', () => {
		const root = fixture_root()

		bench_run.clear_caches(lint_target(), root)

		expect(existsSync(path.join(root, ESLINT_CACHE))).toBe(false)
	})

	// The acceptance criterion at the level of one call: nothing the target did not declare is touched,
	// so a run leaves the working tree exactly as it found it.
	it('leaves every file the target did not declare alone', () => {
		const root = fixture_root()

		bench_run.clear_caches(lint_target(), root)

		expect(existsSync(path.join(root, TRACKED_FILE))).toBe(true)
	})

	it('reports a cache the warm run never rebuilt', () => {
		const root = fixture_root()

		bench_run.clear_caches(lint_target(), root)

		expect(bench_run.residue_notes([measured_sample()], root).join('')).toContain(ESLINT_CACHE)
	})

	it('says nothing where every cleared cache came back', () => {
		expect(bench_run.residue_notes([measured_sample()], fixture_root())).toStrictEqual([])
	})

	// After joshuafolkken/kit#1369 an interrupted run carries a sample for every target it never
	// reached. Nothing was cleared for one of those, so a note accusing the warm run of failing to
	// rebuild its cache would name a cycle that never started.
	it('says nothing about a target that took no reading at all', () => {
		const root = fixture_root()
		const untouched = { target: LINT, caches: [ESLINT_CACHE], readings: [] }

		bench_run.clear_caches(lint_target(), root)

		expect(bench_run.residue_notes([untouched], root)).toStrictEqual([])
	})
})

// The defect round 1 of this feature's review found was a guard checked once at start-up, and the
// guard module's own suite would have stayed green through it — so the assertion that matters is
// that the **call site** refuses, before a single file is removed.
describe('bench run — a gate running mid-measurement stops the clearing', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	// Stubbed at the marker rather than at the guard function, so the whole real chain runs — the
	// stamp read, the liveness probe, the refusal, and the order of the two statements in
	// `take_reading`.
	it('refuses a reading, and removes nothing, while a gate is running', async () => {
		const root = fixture_root()

		mark_gate_running()

		await expect(bench_run.take_reading(lint_target(), root)).rejects.toThrow(
			bench_guard.GATE_RUNNING_MESSAGE,
		)
		expect(existsSync(path.join(root, ESLINT_CACHE))).toBe(true)
	})

	// A reading spawns two real child processes, so this stops at the refusal: what is under test is
	// that the run stops there and says so, not what the checks would have cost. Before
	// joshuafolkken/kit#1369 the refusal was rethrown all the way to the command and every figure
	// taken before it went with it.
	it('stops the target and reports the interruption rather than throwing', async () => {
		const root = fixture_root()

		mark_gate_running()

		const taken = await bench_run.measure_target(lint_target(), 3, root)

		expect(taken.is_interrupted).toBe(true)
		expect(taken.sample.readings).toStrictEqual([])
		expect(taken.sample.target).toBe(LINT)
	})

	// The guard is asked ahead of `clear_caches`, so a target stopped before its first cycle removed
	// nothing — and a `--json` consumer would otherwise find two rows that both read `not measured`
	// disagreeing about what was cleared.
	it('declares no cache for a target it never cleared one for', async () => {
		const root = fixture_root()

		mark_gate_running()

		const taken = await bench_run.measure_target(lint_target(), 3, root)

		expect(taken.sample.caches).toStrictEqual([])
	})

	// The same refusal one level up, where the `--repeat` loop is. Every cycle spawns two real child
	// processes, so what a suite can assert here is that the loop ends and says so; that the cycles
	// taken before it survive into the report is `bench-interrupt.test.ts`'s, which is where the
	// assembly is pure and the issue's acceptance criterion put it.
	it('ends the cycle loop at the refusal instead of raising it', async () => {
		const root = fixture_root()

		mark_gate_running()

		const taken = await bench_run.take_readings(lint_target(), 3, root)

		expect(taken.is_interrupted).toBe(true)
		expect(taken.readings).toStrictEqual([])
		expect(taken.failure_output).toBe('')
	})
})
