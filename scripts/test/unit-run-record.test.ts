import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { unit_run_record, type RunFacts } from './unit-run-record'

// The record line of a whole unit-suite run (joshuafolkken/kit#9109): which bound sized it, what ran
// beside it, and how its duration compares with the recent median — a slow run is said, never failed.

const MEDIAN_MS = 975_240
const SLOW_MS = 2_821_510
const CLAIM_WEIGHT = 4
const FLAG_WORKERS = 4
const DIRECTORY_PREFIX = 'unit-run-record-'

const make_directory = temporary_directory()

const facts: RunFacts = {
	sizing: { bound: 'memory', workers: 3 },
	waited_ms: 12_000,
	runs: { lane: 4, outside: 1, unknown: 0 },
	available_cores: 11,
	machine: { busy_cores: 8.5, available_mb: 2048, run_queue: 14.2 },
	duration_ms: MEDIAN_MS,
}

describe('unit_run_record.deciding_bound — the last stage that changed the count', () => {
	it('names the last bound that changed the count', () => {
		expect(
			unit_run_record.deciding_bound([
				{ bound: 'share', workers: 6 },
				{ bound: 'cores', workers: 6 },
				{ bound: 'memory', workers: 3 },
				{ bound: 'claim', workers: 3 },
			]),
		).toStrictEqual({ bound: 'memory', workers: 3 })
	})

	it('names default when no stage changed the count', () => {
		expect(unit_run_record.deciding_bound([{ bound: 'share', workers: undefined }])).toStrictEqual({
			bound: 'default',
			workers: undefined,
		})
	})
})

describe('unit_run_record.bounded_sizing and typed_sizing — what sized the run', () => {
	it('caps a solo share to the claim it was admitted on', () => {
		const sizing = unit_run_record.bounded_sizing({
			share: undefined,
			free: { cores: undefined, memory_workers: undefined },
			claim: { weight: CLAIM_WEIGHT },
			available_cores: 11,
		})

		expect(sizing).toStrictEqual({ bound: 'claim', workers: 3 })
	})

	it('names a typed --maxWorkers count as the flag bound', () => {
		expect(
			unit_run_record.typed_sizing(['run', `--maxWorkers=${String(FLAG_WORKERS)}`]),
		).toStrictEqual({ bound: 'flag', workers: FLAG_WORKERS })
	})
})

describe('unit_run_record.run_kinds and is_whole_suite — what the run is measured against', () => {
	it('counts lane, outside and unknown runs by their checkout', () => {
		expect(
			unit_run_record.run_kinds([
				{ pid: 1, checkout: '/x/.kit-lanes/9094' },
				{ pid: 2, checkout: '/x/kit' },
				{ pid: 3 },
			]),
		).toStrictEqual({ lane: 1, outside: 1, unknown: 1 })
	})

	it('treats run with flags only as the whole suite, and a file or related run as not', () => {
		expect(unit_run_record.is_whole_suite(['run', '--reporter=dot'])).toBe(true)
		expect(unit_run_record.is_whole_suite(['run', 'scripts/a.test.ts'])).toBe(false)
		expect(unit_run_record.is_whole_suite(['related', 'scripts/a.ts'])).toBe(false)
	})
})

describe('unit_run_record.record_line — one line per whole-suite run', () => {
	it('prints the sizing, the wait, the runs in flight, the machine and the ratio to the median', () => {
		expect(unit_run_record.record_line(facts, MEDIAN_MS)).toBe(
			'test:unit run: 3 workers (bound: memory) · waited 12.0s · 5 runs in flight (lane 4, outside 1, unknown 0) · free 2.5 of 11 cores · 2048 MB free · load 14.2 · 975.2s, 1.00× the median 975.2s',
		)
	})

	it('says slow past twice the median', () => {
		const line = unit_run_record.record_line({ ...facts, duration_ms: SLOW_MS }, MEDIAN_MS)

		expect(line).toContain('2.89× the median 975.2s — slow: over 2× the median')
	})

	it('says no median yet and never slow without a history', () => {
		const line = unit_run_record.record_line({ ...facts, duration_ms: SLOW_MS }, undefined)

		expect(line).toContain('no median yet')
		expect(line).not.toContain('slow')
	})
})

describe('unit_run_record.remember and recent_median — the recent history', () => {
	it('reads the median of the remembered durations', () => {
		const target = path.join(make_directory(DIRECTORY_PREFIX), 'runs.jsonl')

		for (const duration of [900, 1000, 5000]) unit_run_record.remember(target, duration)

		expect(unit_run_record.recent_median(target)).toBe(1000)
	})

	it('has no median when the history is absent', () => {
		const target = path.join(make_directory(DIRECTORY_PREFIX), 'absent.jsonl')

		expect(unit_run_record.recent_median(target)).toBeUndefined()
	})
})
