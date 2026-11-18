import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { lane_catch_rate_stats } from './lane-catch-rate-stats'
import type { GateCheckRecord, LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#7875: one ledger period reduces to a catch rate per check — round 2 per reason
// code, each gate check, each ship preflight kind — and the rows that rarely catch are listed.

const NOW = Date.parse('2026-11-18T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const AT = new Date(NOW - 10 * MS_PER_MINUTE).toISOString()
const OUTSIDE_AT = new Date(NOW - 2 * 24 * 60 * MS_PER_MINUTE).toISOString()
const MIN_RUNS = lane_catch_rate_stats.MIN_CANDIDATE_RUNS

function round_two(code: string, findings?: Array<string>, verdict = 'required'): LedgerEntry {
	return { kind: 'round-two', at: AT, issue: 1, verdict, code, ...(findings && { findings }) }
}

function gate(checks: Array<GateCheckRecord>, at = AT): LedgerEntry {
	return { kind: 'gate', at, elapsed_ms: 0, is_passed: true, checks }
}

function check(label: string, extra: Partial<GateCheckRecord> = {}): GateCheckRecord {
	return { label, elapsed_ms: MS_PER_MINUTE, is_passed: true, ...extra }
}

function preflight(evaluated: Array<string>, unmet: Array<string>): LedgerEntry {
	return { kind: 'preflight', at: AT, issue: 1, evaluated, unmet }
}

function output_of(entries: ReadonlyArray<LedgerEntry>): string {
	return lane_catch_rate_stats.table(entries, WINDOW)
}

function rows_of(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	return output_of(entries).split('\n\n', 1)[0]?.split('\n').slice(2) ?? []
}

function repeated(count: number, entry: LedgerEntry): Array<LedgerEntry> {
	return Array.from({ length: count }, () => entry)
}

describe('lane_catch_rate_stats.table', () => {
	it('prints a none row and no candidates for a period with no record', () => {
		const output = output_of([gate([check('lint')], OUTSIDE_AT)])

		expect(rows_of([])).toStrictEqual(['| none | 0 | 0 | not measured | not measured | 0 |'])
		expect(output).toContain('low catch rate (rate ≤ 5.0%, runs ≥ 20): none')
	})

	it('counts a failed gate check as a catch and leaves reused and unmoved runs out', () => {
		const checks = [
			check('lint', { is_passed: false }),
			check('lint'),
			check('lint', { is_passed: false, is_reused: true }),
			check('lint', { is_passed: false, is_unmoved: true }),
		]

		expect(rows_of([gate(checks)])).toStrictEqual(['| lint | 2 | 1 | 50.0 | 2.0 | 0 |'])
	})

	it('prints not measured for a check with only reused runs', () => {
		const reused = gate([check('cspell', { is_reused: true })])

		expect(rows_of([reused])).toStrictEqual(['| cspell | 0 | 0 | not measured | 0.0 | 0 |'])
	})

	it('counts an old round 2 with no findings under no outcome, outside the rate', () => {
		const entries = [
			round_two('live', ['bug:high']),
			round_two('live', []),
			round_two('live'),
			round_two('empty', undefined, 'skip'),
		]

		expect(rows_of(entries)).toStrictEqual(['| round 2 live | 2 | 1 | 50.0 | not measured | 1 |'])
	})
})

describe('lane_catch_rate_stats.table preflight and candidates', () => {
	it('counts each preflight kind evaluated as a run and each unmet kind as a catch', () => {
		const entries = [preflight(['lock', 'scoped'], []), preflight(['lock', 'scoped'], ['lock'])]

		expect(rows_of(entries)).toStrictEqual([
			'| preflight lock | 2 | 1 | 50.0 | not measured | 0 |',
			'| preflight scoped | 2 | 0 | 0.0 | not measured | 0 |',
		])
	})

	it('lists a row at the threshold rate with the minimum runs as a candidate', () => {
		const entries = [
			gate([check('metrics', { is_passed: false })]),
			...repeated(MIN_RUNS - 1, gate([check('metrics')])),
		]

		expect(output_of(entries)).toContain('runs ≥ 20): metrics')
	})

	it('leaves out a row under the minimum runs or above the threshold rate', () => {
		const entries = [
			...repeated(MIN_RUNS - 1, gate([check('exports')])),
			...repeated(2, gate([check('lint', { is_passed: false })])),
			...repeated(MIN_RUNS - 2, gate([check('lint')])),
		]

		expect(output_of(entries)).toContain('runs ≥ 20): none')
	})
})
