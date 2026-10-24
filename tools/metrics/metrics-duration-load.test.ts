import type { LedgerEntry } from '#scripts/lane/lane-ledger'
import { describe, expect, it } from 'vitest'
import { metrics_duration_load } from './metrics-duration-load'

const CORES = 8
const GATE_MS = 10_000
const HOUR_MS = 3_600_000
// Offsets from a gate's end: inside the gate, within one sample period after its end or before its
// start, just past that period after it, and the idle gap half an hour after it.
const INSIDE_MS = -5000
const AFTER_MS = 30_000
const BEFORE_MS = -GATE_MS - AFTER_MS
const PAST_MS = 61_000
const GAP_MS = HOUR_MS / 2
const HOURS = [1, 2, 3, 4, 5]
const MAJORITY = [1, 2, 3]
const MINORITY = [4, 5]

// Five solo gates of ten seconds ending at 01:00 … 05:00; the median reads these spans alone.
const GATES: ReadonlyArray<LedgerEntry> = HOURS.map((hour) => ({
	kind: 'gate',
	at: `2026-10-23T0${String(hour)}:00:00Z`,
	elapsed_ms: GATE_MS,
	is_passed: true,
	unit_ms: GATE_MS,
	external_cores: 0,
}))

// One load sample per named gate, at the offset from the end of the gate that ends at that hour.
function loads(
	hours: ReadonlyArray<number>,
	offset_ms: number,
	sample: { load?: number; lanes?: number },
): ReadonlyArray<LedgerEntry> {
	return hours.map((hour) => ({
		kind: 'load',
		at: new Date(Date.parse('2026-10-23T00:00:00Z') + hour * HOUR_MS + offset_ms).toISOString(),
		load: sample.load ?? 1,
		lanes: sample.lanes,
	}))
}

function is_busy(samples: ReadonlyArray<LedgerEntry>): boolean {
	return metrics_duration_load.is_busy([...GATES, ...samples], CORES)
}

describe('metrics_duration_load.is_busy', () => {
	it('is busy where another lane worked inside three of the five gates', () => {
		expect(is_busy(loads(MAJORITY, INSIDE_MS, { lanes: 2 }))).toBe(true)
	})

	it('is quiet where another lane worked inside two of the five gates', () => {
		expect(is_busy(loads(MINORITY, INSIDE_MS, { lanes: 6 }))).toBe(false)
	})

	it('is busy where the load average passed the cores inside three of the five gates', () => {
		expect(is_busy(loads(MAJORITY, INSIDE_MS, { load: CORES + 1, lanes: 1 }))).toBe(true)
	})

	it("is quiet where one lane — the gate's own — worked under the cores", () => {
		expect(is_busy(loads(HOURS, INSIDE_MS, { load: CORES, lanes: 1 }))).toBe(false)
	})

	it('is quiet where the busy samples came before the oldest gate', () => {
		expect(is_busy(loads([0, 0, 0], AFTER_MS, { lanes: 6 }))).toBe(false)
	})

	it('is quiet where the ledger holds no load sample', () => {
		expect(is_busy([])).toBe(false)
	})

	it('is quiet where too few gates open a window', () => {
		const entries = [...GATES.slice(1), ...loads([2, 3, 4, 5], INSIDE_MS, { lanes: 6 })]

		expect(metrics_duration_load.is_busy(entries, CORES)).toBe(false)
	})
})

describe('metrics_duration_load.is_busy — the gate spans', () => {
	it('is quiet where the busy samples fell in the idle gaps between gates', () => {
		expect(is_busy(loads(MAJORITY, GAP_MS, { lanes: 6 }))).toBe(false)
	})

	it('is busy where the busy samples came within one sample period after the gates', () => {
		expect(is_busy(loads(MAJORITY, AFTER_MS, { lanes: 2 }))).toBe(true)
	})

	it('is busy where the busy samples came within one sample period before the gates', () => {
		expect(is_busy(loads(MAJORITY, BEFORE_MS, { lanes: 2 }))).toBe(true)
	})

	it('is quiet where the busy samples came just past one sample period after the gates', () => {
		expect(is_busy(loads(MAJORITY, PAST_MS, { lanes: 2 }))).toBe(false)
	})
})

describe('metrics_duration_load.split', () => {
	const gate_change = { name: 'gate', baseline: GATE_MS, current: GATE_MS * 2 }
	const startup_change = { name: 'josh_startup', baseline: GATE_MS, current: GATE_MS * 2 }

	it('warns on the gate and unit regressions of a busy interval and still fails a startup', () => {
		expect(metrics_duration_load.split([gate_change, startup_change], true)).toStrictEqual({
			warned: [gate_change],
			failed: [startup_change],
		})
	})

	it('fails every regression of a quiet interval', () => {
		expect(metrics_duration_load.split([gate_change, startup_change], false)).toStrictEqual({
			warned: [],
			failed: [gate_change, startup_change],
		})
	})
})

describe('metrics_duration_load.render_warning', () => {
	it('names the warning before the regressions it does not fail on', () => {
		const text = metrics_duration_load.render_warning(
			[{ name: 'gate', baseline: 7100, current: 10_500 }],
			'durations.json',
		)

		expect(text).toMatch(/^josh metrics: warning/u)
		expect(text).toContain('gate  baseline 7.1s → current 10.5s')
	})
})
