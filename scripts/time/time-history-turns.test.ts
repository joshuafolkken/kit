import { time_history, type RunTimeRecord } from '#scripts/time-runtime/time-history'
import { describe, expect, it } from 'vitest'
import { parent_turns_of } from './time-history-turns'
import { time_report_fixture } from './time-report-fixture'

// joshuafolkken/kit#2003. The turn breakdown a period report aggregates is written by the runtime
// recorder and read back here, apart from it. These cases pin the round trip: what a measured run
// reconstructs to, and that a record written before the breakdown existed reads as unmeasured.

const MS_PER_MINUTE = 60_000
const RECORDED_AT = '2026-01-01T00:00:00.000Z'
const CURRENT_ISSUE = 1471
const TURN_COUNT = 40
const TOOL_CALL_COUNT = 120
const MS_PER_ROUND_TRIP = 27_000
const MODEL_MS_PER_ROUND_TRIP = 22_000
const CI_MS = 2 * MS_PER_MINUTE

// A record shaped like one written before the breakdown field existed: no `by_contributor` at all,
// which is the case the read-back reports as unmeasured.
function record(issue: number, elapsed_minutes: number, round_trip_count: number): RunTimeRecord {
	return {
		issue,
		recorded_at: RECORDED_AT,
		elapsed_ms: elapsed_minutes * MS_PER_MINUTE,
		turn_count: TURN_COUNT,
		tool_call_count: TOOL_CALL_COUNT,
		round_trip_count,
		ms_per_round_trip: MS_PER_ROUND_TRIP,
		model_ms_per_round_trip: MODEL_MS_PER_ROUND_TRIP,
	}
}

describe('parent_turns_of — the turn breakdown a period report aggregates', () => {
	it('reads a written breakdown back as measured totals', () => {
		const report = time_report_fixture.run_report(time_report_fixture.MIXED, CI_MS)
		const kept = time_history.to_record(CURRENT_ISSUE, report, RECORDED_AT)

		// Against the report's own totals rather than against a named field: what has to survive the
		// round trip is that the rows still add up to the total their shares are computed from.
		expect(parent_turns_of(kept)).toStrictEqual(report.parent_turns)
	})

	it('reads a record written before the breakdown existed as unmeasured', () => {
		expect(parent_turns_of(record(CURRENT_ISSUE, 30, 100)).is_measured).toBe(false)
	})
})
