import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { lane_implement_rate } from './lane-implement-rate'
import type { LedgerEntry } from './lane-ledger-schema'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#6021: implement minutes per 100 actual non-test lines, joined by issue over the
// period's merged lanes.

const NOW = Date.parse('2026-10-30T12:00:00Z')
const WINDOW = lane_stats.window_of(1, NOW)
const BEFORE_WINDOW_MINUTES = 3000
const MERGED_MINUTES = 60
const SIZED_MINUTES = 120
const SHIP_MINUTES = 5

function at(minutes_before: number): string {
	return new Date(NOW - minutes_before * MS_PER_MINUTE).toISOString()
}

// A lane dispatched `implement` minutes before its first ship stage started, sized and merged.
function lane(issue: number, implement: number, lines: number): Array<LedgerEntry> {
	const dispatched = SIZED_MINUTES + implement

	return [
		{ kind: 'dispatch', at: at(dispatched), issue },
		{
			kind: 'stage',
			at: at(SIZED_MINUTES - SHIP_MINUTES),
			stage: 'preflight',
			elapsed_ms: SHIP_MINUTES * MS_PER_MINUTE,
			issue,
		},
		{
			kind: 'size',
			at: at(SIZED_MINUTES),
			issue,
			declared: { files: 2, lines: 100 },
			actual: { files: 2, lines },
		},
		{ kind: 'merge', at: at(MERGED_MINUTES), issue },
	]
}

// An earlier dispatch of `issue` whose ship started, then stopped: 60 implement minutes, never merged.
function stopped(issue: number): Array<LedgerEntry> {
	return [
		{ kind: 'dispatch', at: at(BEFORE_WINDOW_MINUTES), issue },
		{
			kind: 'stage',
			at: at(BEFORE_WINDOW_MINUTES - MERGED_MINUTES),
			stage: 'preflight',
			elapsed_ms: 0,
			issue,
		},
	]
}

function row(entries: ReadonlyArray<LedgerEntry>): string | undefined {
	return lane_implement_rate.table(entries, WINDOW).split('\n', 3)[2]
}

describe('lane_implement_rate.rate', () => {
	it('answers the median minutes per 100 actual lines of the merged lanes', () => {
		const entries = [...lane(1, 30, 100), ...lane(2, 40, 200), ...lane(3, 90, 300)]

		expect(lane_implement_rate.rate(entries, WINDOW)).toStrictEqual({ median: 30, lanes: 3 })
	})

	it('counts a lane dispatched before the window it merged in', () => {
		expect(lane_implement_rate.rate(lane(1, BEFORE_WINDOW_MINUTES, 1000), WINDOW)).toStrictEqual({
			median: 300,
			lanes: 1,
		})
	})

	it('reads a reissued lane by its latest dispatch', () => {
		expect(lane_implement_rate.rate([...stopped(1), ...lane(1, 30, 100)], WINDOW)).toStrictEqual({
			median: 30,
			lanes: 1,
		})
	})

	it('leaves out zero-line, unmerged and unsized lanes', () => {
		const unmerged = lane(2, 30, 100).filter((entry) => entry.kind !== 'merge')
		const unsized = lane(3, 30, 100).filter((entry) => entry.kind !== 'size')

		const entries = [...lane(1, 30, 0), ...unmerged, ...unsized]

		expect(lane_implement_rate.rate(entries, WINDOW)).toBeUndefined()
	})

	it('answers undefined on an empty ledger', () => {
		expect(lane_implement_rate.rate([], WINDOW)).toBeUndefined()
	})
})

describe('lane_implement_rate.minutes_for', () => {
	it('projects the implement minutes of a line count at the measured rate', () => {
		expect(lane_implement_rate.minutes_for(240, { median: 10, lanes: 4 })).toBe(24)
	})
})

describe('lane_implement_rate.lines_for', () => {
	it('inverts the measured minutes using the shared rate unit', () => {
		const measured = { median: 17.7, lanes: 1 }
		const lines = lane_implement_rate.lines_for(12, measured)

		expect(lines).toBeCloseTo(1200 / 17.7)
		expect(lane_implement_rate.minutes_for(lines ?? 0, measured)).toBeCloseTo(12)
	})

	it('has no projection without a measurement', () => {
		expect(lane_implement_rate.lines_for(12, undefined)).toBeUndefined()
	})

	it.each([0, -1, NaN, Infinity, -Infinity])(
		'has no projection for an invalid rate %s',
		(median) => {
			expect(lane_implement_rate.lines_for(12, { median, lanes: 1 })).toBeUndefined()
		},
	)
})

describe('lane_implement_rate.table', () => {
	it('prints the lane count and the median, a dash when none is measured', () => {
		expect(row([...lane(1, 30, 200)])).toBe('| 1 | 15.0 |')
		expect(row([])).toBe('| 0 | — |')
	})
})
