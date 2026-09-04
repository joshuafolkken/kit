import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { review_stamps } from '#scripts/review/review-stamps'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bench_guard } from './bench-guard'
import { bench_run } from './bench-run'
import { bench_targets, type BenchTarget } from './bench-targets'

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

function lint_target(): BenchTarget {
	const target = bench_targets.find_target('lint')

	expect(target).toBeDefined()

	return target ?? { name: 'lint', caches: [], flags: [] }
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
		const sample = { target: 'lint', caches: [ESLINT_CACHE], readings: [] }

		bench_run.clear_caches(lint_target(), root)

		expect(bench_run.residue_notes([sample], root).join('')).toContain(ESLINT_CACHE)
	})

	it('says nothing where every cleared cache came back', () => {
		const sample = { target: 'lint', caches: [ESLINT_CACHE], readings: [] }

		expect(bench_run.residue_notes([sample], fixture_root())).toStrictEqual([])
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
	// that the run aborts rather than returning a sample of whatever it managed, not what the checks
	// would have cost.
	it('aborts the whole measurement rather than returning a partial sample', async () => {
		const root = fixture_root()

		mark_gate_running()

		await expect(bench_run.measure_target(lint_target(), 3, root)).rejects.toThrow(
			bench_guard.GATE_RUNNING_MESSAGE,
		)
	})
})
