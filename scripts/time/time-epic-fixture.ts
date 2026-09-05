import { expect } from 'vitest'
import { time_bundles } from './time-bundles'
import type { CheckTotal } from './time-checks'
import { time_epic, type EpicTimeReport } from './time-epic'
import { time_failures } from './time-failures'
import { time_gaps } from './time-gaps'
import type { PhaseTotal } from './time-phases'
import type { TimeReport } from './time-report'
import { time_tool_turns } from './time-tool-turns'

// What the epic-aggregation suites read, written once rather than in each test file
// (joshuafolkken/kit#1300).
//
// `time-epic.test.ts` covers the aggregation itself and `time-epic-children.test.ts` covers how the
// batch drives its children, so both need the same three things: a report shaped like the one
// `time_run` hands back, an epic body holding a task list, and a `GhReader` that answers from it.
// Restating them beside each suite would be the clone `CLAUDE.md` prohibits, in the one place where
// a drift would make the two suites disagree about what a child looks like.

const CWD = '/Users/someone/Development/kit'
const MINUTE_MS = 60_000
const EPIC = 1272

const FIXTURE_YEAR = 2026

function at(minute: number): string {
	return new Date(Date.UTC(FIXTURE_YEAR, 0, 1, 0, minute)).toISOString()
}

interface ReportInput {
	issue_number: number
	start_minute?: number
	model_ms?: number
	turn_count?: number
	span_count?: number
	has_ci_data?: boolean
	// The two breakdowns a distribution is taken across (joshuafolkken/kit#1312). Absent for every
	// epic case, which reads neither — so a report built without them is exactly what it always was.
	phases?: ReadonlyArray<PhaseTotal>
	by_check?: ReadonlyArray<CheckTotal>
}

const DEFAULTS = { model_ms: MINUTE_MS, turn_count: 1, span_count: 2, has_ci_data: true }

// The round-trip figures no epic-aggregation case reads. Held apart from the report so what a case
// *does* vary stays visible in one screen.
const ZERO_COUNTS = {
	tool_call_count: 0,
	round_trip_count: 0,
	...time_tool_turns.NO_TURN_SPLIT,
	ms_per_round_trip: 0,
	model_ms_per_round_trip: 0,
}

type Breakdown = Pick<
	TimeReport,
	| 'notes'
	| 'phases'
	| 'by_tool'
	| 'by_josh_command'
	| 'segments'
	| 'by_invocation'
	| 'by_check'
	| 'gaps'
	| 'bundles'
	| 'failures'
>

// Fresh arrays per report rather than one shared set: a case that appends to a report's notes would
// otherwise be appending to every other report the fixture ever built.
function empty_breakdown(): Breakdown {
	return {
		notes: [],
		phases: [],
		segments: [],
		by_tool: [],
		by_josh_command: [],
		by_invocation: [],
		by_check: [],
		gaps: { ...time_gaps.NO_GAPS },
		bundles: { ...time_bundles.NO_BUNDLES },
		failures: { ...time_failures.NO_FAILURES },
	}
}

function breakdown_of(input: ReportInput): Breakdown {
	return {
		...empty_breakdown(),
		phases: [...(input.phases ?? [])],
		by_check: [...(input.by_check ?? [])],
	}
}

// A report shaped like the one `time_run` hands back, with only the fields the aggregation reads
// varied. Building it through `time_report.build_from_spans` would need spans these tests have no
// use for.
function report_of(input: ReportInput): TimeReport {
	const { issue_number, start_minute, model_ms, turn_count, span_count, has_ci_data } = {
		...DEFAULTS,
		...input,
	}
	const is_timed = span_count > 0 || has_ci_data

	return {
		scope: `issue #${String(issue_number)}`,
		started_at: start_minute === undefined ? '' : at(start_minute),
		ended_at: start_minute === undefined ? '' : at(start_minute + 1),
		// A child nothing was read for really does elapse nothing, so the fixture cannot assert a total
		// that the aggregation could never produce.
		elapsed_ms: is_timed ? model_ms + MINUTE_MS : 0,
		span_count,
		turn_count,
		...ZERO_COUNTS,
		categories: { model_ms, tool_ms: MINUTE_MS, human_ms: 0, ci_ms: 0 },
		has_ci_data,
		...breakdown_of(input),
	}
}

// The child numbers the rows are written from, so a suite asserting the order it got back compares
// against the same three numbers the body declared rather than a second list that can drift from it.
const FIRST_CHILD = 101
const SECOND_CHILD = 102
const THIRD_CHILD = 103

function done_row(issue_number: number): string {
	return `- [x] #${String(issue_number)}`
}

const ROW_101 = done_row(FIRST_CHILD)
const ROW_102 = done_row(SECOND_CHILD)
const ROW_103 = done_row(THIRD_CHILD)
const OPEN_ROW_101 = `- [ ] #${String(FIRST_CHILD)}`
const FENCE = '```'

function body_of(rows: ReadonlyArray<string>): string {
	return ['## Progress', '', ...rows].join('\n')
}

const PAIR_BODY = body_of([ROW_101, ROW_102])
const TRIO_ROWS = [ROW_101, ROW_102, ROW_103]
const TRIO = [FIRST_CHILD, SECOND_CHILD, THIRD_CHILD]

// Every read the aggregation makes goes through one `GhReader`, so a test hands it a function and
// never a network. Two paths reach it: the epic body, and the pull-request listing the batch pages
// once for the whole batch (joshuafolkken/kit#1292). The listing defaults to an empty page, which
// ends the walk in one request; a case that asserts what each child was handed scripts a real page
// instead, because two children given the same empty answer cannot tell per-child routing from a
// single shared result.
const EMPTY_PAGE = '[]'

function reader_of(
	body: string,
	asked: Array<string> = [],
	pulls_body: string = EMPTY_PAGE,
): (path: string) => Promise<string> {
	return async (path: string) => {
		asked.push(path)

		if (path.includes('pulls')) return pulls_body

		expect(path).toContain(`issues/${String(EPIC)}`)

		return JSON.stringify({ body })
	}
}

// The report, or a failure. Assertions then read `report.x` rather than `report?.x`, which is not
// only shorter: an optional chain would let every one of them pass against an `undefined` report.
async function batch_of(body: string): Promise<EpicTimeReport> {
	const report = await time_epic.build_epic_report(EPIC, CWD, reader_of(body))

	if (report === undefined) throw new Error('the epic could not be read')

	return report
}

const time_epic_fixture = {
	CWD,
	MINUTE_MS,
	EPIC,
	EMPTY_PAGE,
	ROW_101,
	ROW_102,
	ROW_103,
	OPEN_ROW_101,
	FENCE,
	PAIR_BODY,
	TRIO_ROWS,
	TRIO,
	FIRST_CHILD,
	SECOND_CHILD,
	THIRD_CHILD,
	at,
	report_of,
	body_of,
	reader_of,
	batch_of,
}

export type { ReportInput }
export { time_epic_fixture }
