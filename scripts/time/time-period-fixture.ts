import type { RunTimeRecord } from './time-history'
import { time_period, type PeriodTimeReport } from './time-period'

// The records a period report is built from, in one place (joshuafolkken/kit#1470).
//
// Both the aggregation's cases and the renderer's are about the same two shapes — runs that never
// overlapped and runs that did — so the builder lives beside them rather than being written out
// twice, exactly as `time-report-fixture.ts` is shared by the readers of a run report.

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const BASE_MS = Date.parse('2026-09-01T00:00:00.000Z')
// The period scope never touches the filesystem when a reader is supplied, so the root is a label.
const ROOT = '/root/that/is/never/read'
const ISSUE_A = 11
const ISSUE_B = 22
const WEEK_DAYS = 7
const ONE = 1

function record(issue: number, start_ms: number, duration_ms: number): RunTimeRecord {
	const ended_ms = start_ms + duration_ms

	return {
		issue,
		recorded_at: new Date(ended_ms).toISOString(),
		started_at: new Date(start_ms).toISOString(),
		ended_at: new Date(ended_ms).toISOString(),
		elapsed_ms: duration_ms,
		turn_count: ONE,
		tool_call_count: ONE,
		round_trip_count: ONE,
		ms_per_round_trip: duration_ms,
		model_ms_per_round_trip: duration_ms,
	}
}

// A record as it was written before the window was stored — the two fields joshuafolkken/kit#1470
// added, absent.
function undated(issue: number): RunTimeRecord {
	return { ...record(issue, BASE_MS, HOUR_MS), started_at: undefined, ended_at: undefined }
}

function reader_of(records: ReadonlyArray<RunTimeRecord>): (root: string) => Array<RunTimeRecord> {
	function read(): Array<RunTimeRecord> {
		return [...records]
	}

	return read
}

function build(
	records: ReadonlyArray<RunTimeRecord>,
	days: number = WEEK_DAYS,
): PeriodTimeReport | undefined {
	return time_period.build_period_report(days, ROOT, reader_of(records))
}

// The same build, for the cases that are about the report rather than about its absence. A caller
// asserting on the table would otherwise carry an optional through every expectation.
function built(records: ReadonlyArray<RunTimeRecord>, days: number = WEEK_DAYS): PeriodTimeReport {
	const report = build(records, days)

	if (report === undefined) throw new Error('the fixture records produced no period report')

	return report
}

// Two runs that never share a minute, and two that share every minute they have.
const SERIAL = [record(ISSUE_A, BASE_MS, HOUR_MS), record(ISSUE_B, BASE_MS + HOUR_MS, HOUR_MS)]
const OVERLAPPING = [record(ISSUE_A, BASE_MS, HOUR_MS), record(ISSUE_B, BASE_MS, HOUR_MS)]

const time_period_fixture = {
	MINUTE_MS,
	HOUR_MS,
	DAY_MS,
	BASE_MS,
	ISSUE_A,
	ISSUE_B,
	SERIAL,
	OVERLAPPING,
	record,
	undated,
	build,
	built,
}

export { time_period_fixture }
