import { describe, expect, it } from 'vitest'
import { time_period } from './time-period'
import { time_period_fixture } from './time-period-fixture'

// A period as the unit of a report (joshuafolkken/kit#1470). The cases are about what the records
// can and cannot support: a window derived from the runs themselves, a lane count that degrades to
// one when nothing overlapped, and a record with no window excluded rather than placed at the epoch.

const { HOUR_MS, DAY_MS, BASE_MS, ISSUE_A, ISSUE_B, SERIAL, OVERLAPPING } = time_period_fixture
const { record, undated, build } = time_period_fixture

describe('time_period.build_period_report', () => {
	it('has no report at all when no record carries a wall-clock window', () => {
		expect(build([undated(ISSUE_A)])).toBeUndefined()
	})

	it('reports one lane, and says so, when no two runs overlapped', () => {
		const report = build(SERIAL)

		expect(report?.lane_count).toBe(1)
		expect(report?.notes).toContain(time_period.SINGLE_LANE_NOTE)
	})

	it('reports the effective lane count against the lanes that were open', () => {
		const report = build(OVERLAPPING)

		expect(report?.lane_count).toBe(2)
		expect(report?.effective_lanes).toBeCloseTo(2)
		expect(report?.runs_per_hour).toBeCloseTo(2)
	})
})

describe('time_period.build_period_report lane totals', () => {
	it('measures idle against the window the runs cover, not the calendar period', () => {
		const lanes = build(OVERLAPPING)?.lanes ?? []

		expect(lanes).toHaveLength(2)
		expect(lanes[0]).toStrictEqual({
			index: 0,
			run_count: 1,
			busy_ms: HOUR_MS,
			idle_ms: 0,
			issues: [ISSUE_A],
		})
	})

	it('leaves a lane that sat out half the window with that half as idle', () => {
		const late = record(ISSUE_B, BASE_MS + HOUR_MS, HOUR_MS)
		const lanes = build([record(ISSUE_A, BASE_MS, 2 * HOUR_MS), late])?.lanes ?? []

		expect(lanes[1]?.busy_ms).toBe(HOUR_MS)
		expect(lanes[1]?.idle_ms).toBe(HOUR_MS)
	})
})

describe('time_period.build_period_report contention', () => {
	it('names the run that held the only busy lane, longest stretch first', () => {
		const held = record(ISSUE_A, BASE_MS, 3 * HOUR_MS)
		const brief = record(ISSUE_B, BASE_MS + HOUR_MS, time_period_fixture.MINUTE_MS)
		const stretches = build([held, brief])?.serialization ?? []

		expect(stretches.map((one) => one.issue)).toStrictEqual([ISSUE_A, ISSUE_A])
		expect(stretches[0]?.started_ms).toBe(BASE_MS + HOUR_MS + time_period_fixture.MINUTE_MS)
	})

	it('separates the wall clock another run was hiding from the wall clock that was exposed', () => {
		expect(build(OVERLAPPING)?.hidden_ms).toBe(2 * HOUR_MS)
		expect(build(OVERLAPPING)?.exposed_ms).toBe(0)
		expect(build(SERIAL)?.exposed_ms).toBe(2 * HOUR_MS)
	})
})

describe('time_period.build_period_report window', () => {
	it('drops the runs that finished before the period began', () => {
		const old = record(ISSUE_A, BASE_MS - 10 * DAY_MS, HOUR_MS)
		const report = build([old, record(ISSUE_B, BASE_MS, HOUR_MS)])

		expect(report?.run_count).toBe(1)
		expect(report?.lanes[0]?.issues).toStrictEqual([ISSUE_B])
	})

	it('counts the issues finished on each day, in date order', () => {
		const next_day = record(ISSUE_B, BASE_MS + DAY_MS, HOUR_MS)

		expect(build([...SERIAL, next_day])?.by_day).toStrictEqual([
			{ date: '2026-09-01', run_count: 2, elapsed_ms: 2 * HOUR_MS },
			{ date: '2026-09-02', run_count: 1, elapsed_ms: HOUR_MS },
		])
	})

	it('excludes a record with no window and says how many it excluded', () => {
		const report = build([...SERIAL, undated(ISSUE_A)])

		expect(report?.undated_count).toBe(1)
		expect(report?.notes).toContain(time_period.undated_note(1))
	})

	// The history keeps two hundred runs; a count taken across all of them would answer a question
	// about one day with the number of windowless records in the whole file.
	it('counts only the windowless records that fall inside the period', () => {
		const stale = {
			...undated(ISSUE_A),
			recorded_at: new Date(BASE_MS - 10 * DAY_MS).toISOString(),
		}

		expect(build([...SERIAL, stale])?.undated_count).toBe(0)
	})

	it('has no report for a window that holds no run at all', () => {
		expect(build(SERIAL, -1)).toBeUndefined()
	})
})
