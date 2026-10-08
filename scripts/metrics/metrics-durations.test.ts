import type { LedgerEntry } from '#scripts/lane/lane-ledger'
import { describe, expect, it } from 'vitest'
import { metrics_durations } from './metrics-durations'

const BASELINE_MS = 1000
const WITHIN_TOLERANCE_MS = 1100
const PAST_TOLERANCE_MS = 1101

function gate(elapsed_ms: number, unit_ms?: number, is_passed = true): LedgerEntry {
	return { kind: 'gate', at: '2026-10-08T00:00:00Z', elapsed_ms, is_passed, unit_ms }
}

// A gate that ran the unit suite for its whole span, ending at `at`.
function gate_at(at: string, elapsed_ms: number, is_passed = true): LedgerEntry {
	return { kind: 'gate', at, elapsed_ms, is_passed, unit_ms: elapsed_ms }
}

describe('metrics_durations.compare — the tolerance', () => {
	it('passes a duration up to 10% over the baseline', () => {
		const verdict = metrics_durations.compare({ gate: BASELINE_MS }, { gate: WITHIN_TOLERANCE_MS })

		expect(verdict.regressions).toStrictEqual([])
		expect(verdict.is_extended).toBe(false)
	})

	it('fails a duration more than 10% over the baseline, naming both values', () => {
		const verdict = metrics_durations.compare(
			{ josh_startup: BASELINE_MS },
			{ josh_startup: PAST_TOLERANCE_MS },
		)

		expect(verdict.regressions).toStrictEqual([
			{ name: 'josh_startup', baseline: BASELINE_MS, current: PAST_TOLERANCE_MS },
		])
	})
})

describe('metrics_durations.compare — the baseline', () => {
	it('keeps the baseline when a duration got faster', () => {
		const verdict = metrics_durations.compare({ unit: BASELINE_MS }, { unit: 1 })

		expect(verdict).toStrictEqual({
			regressions: [],
			baseline: { unit: BASELINE_MS },
			is_extended: false,
		})
	})

	it('records a first measurement as the baseline instead of comparing it', () => {
		const verdict = metrics_durations.compare({}, { guard_startup: BASELINE_MS })

		expect(verdict).toStrictEqual({
			regressions: [],
			baseline: { guard_startup: BASELINE_MS },
			is_extended: true,
		})
	})

	it('leaves an unmeasured duration out of the comparison', () => {
		const verdict = metrics_durations.compare({ gate: BASELINE_MS }, { gate: undefined })

		expect(verdict.regressions).toStrictEqual([])
	})
})

const NOT_MEASURED = { gate: undefined, unit: undefined }

// The gates one an hour apart, so none overlaps another.
function hourly(entries: ReadonlyArray<LedgerEntry>): ReadonlyArray<LedgerEntry> {
	return entries.map((entry, hour) => ({
		...entry,
		at: new Date(Date.UTC(2026, 9, 8, hour)).toISOString(),
	}))
}

describe('metrics_durations.from_ledger — the median', () => {
	it('takes the median of the last five solo gates that ran the unit suite', () => {
		const entries = hourly([
			gate(BASELINE_MS * 9, BASELINE_MS * 9),
			...[5, 1, 3, 2].map((seconds) => gate(seconds * BASELINE_MS, seconds)),
			gate(BASELINE_MS * 4, 4, false),
			gate(BASELINE_MS * 7),
		])

		expect(metrics_durations.from_ledger(entries)).toStrictEqual({ gate: 3000, unit: 3 })
	})

	// joshuafolkken/kit#3409: a gate failed by this step's own slowdown still counts, so fixing the
	// slowdown clears the reading instead of latching it.
	it('reads failed solo gates, so a fixed slowdown clears the median', () => {
		const entries = hourly(
			[90, 90, 30, 30, 30].map((seconds) => gate(seconds * BASELINE_MS, seconds, false)),
		)

		expect(metrics_durations.from_ledger(entries)).toStrictEqual({ gate: 30_000, unit: 30 })
	})

	it('reads no gate duration from fewer than five solo gates', () => {
		const entries = hourly([1, 2, 3, 4].map((seconds) => gate(seconds * BASELINE_MS, seconds)))

		expect(metrics_durations.from_ledger(entries)).toStrictEqual(NOT_MEASURED)
	})

	it('reads no gate duration from an empty ledger', () => {
		expect(metrics_durations.from_ledger([])).toStrictEqual(NOT_MEASURED)
	})
})

describe('metrics_durations.from_ledger — solo gates', () => {
	// joshuafolkken/kit#3409: only solo gates compare — a gate that overlapped another, failed or
	// passed, ran under its load.
	it('leaves out every gate whose span overlapped another gate', () => {
		const solo = [6, 7, 8, 9, 10].map((minute) =>
			gate_at(`2026-10-08T00:${String(minute).padStart(2, '0')}:00Z`, 50_000),
		)
		const entries = [
			gate_at('2026-10-08T00:01:00Z', 60_000),
			gate_at('2026-10-08T00:02:00Z', 90_000),
			gate_at('2026-10-08T00:03:30Z', 60_000, false),
			gate_at('2026-10-08T00:04:00Z', 40_000),
			...solo,
		]

		expect(metrics_durations.from_ledger(entries)).toStrictEqual({ gate: 50_000, unit: 50_000 })
	})
})

describe('metrics_durations.render', () => {
	const durations = { gate: 312_400, josh_startup: 171.4 }

	it('prints every duration, a dash where none was measured', () => {
		expect(metrics_durations.render(durations, true)).toBe(
			'durations  gate 312.4s · unit — · josh_startup 171ms · guard_startup —',
		)
	})

	it('leaves the startups out when they were not timed', () => {
		expect(metrics_durations.render(durations, false)).toBe('durations  gate 312.4s · unit —')
	})
})

describe('metrics_durations baseline file', () => {
	it('round-trips rounded values and drops unknown names', () => {
		const text = metrics_durations.baseline_text({ gate: 1234.6, unit: 99.2 })

		expect(metrics_durations.parse_baseline(text)).toStrictEqual({ gate: 1235, unit: 99 })
		expect(metrics_durations.parse_baseline('{"other": 1, "gate": 2}')).toStrictEqual({ gate: 2 })
	})

	it('reads an unreadable baseline as empty', () => {
		expect(metrics_durations.parse_baseline('not json')).toStrictEqual({})
	})
})
