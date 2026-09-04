import { describe, expect, it } from 'vitest'
import { time_batch, type RunTiming } from './time-batch'
import { time_epic, type EpicTimeReport } from './time-epic'
import { time_epic_report } from './time-epic-report'
import { time_failures } from './time-failures'
import type { TimeReport } from './time-report'
import { time_run } from './time-run'

const MINUTE_MS = 60_000
const EPIC = 1272

interface ChildInput {
	issue_number: number
	status?: RunTiming['status']
	elapsed_minutes?: number
	model_minutes?: number
	turn_count?: number
}

// The two halves a status is decided from, so a fixture cannot claim a status its own report
// contradicts — a `no transcript` child carrying spans would let the formatter pass on a shape
// `time_epic` never produces.
interface Halves {
	span_count: number
	has_ci_data: boolean
}

const HALVES = new Map<RunTiming['status'], Halves>([
	[time_batch.MEASURED, { span_count: 2, has_ci_data: true }],
	[time_batch.NO_TRANSCRIPT, { span_count: 0, has_ci_data: true }],
	[time_batch.NOT_MERGED, { span_count: 2, has_ci_data: false }],
	[time_batch.NOT_RUN, { span_count: 0, has_ci_data: false }],
	// A report the batch built for a child whose measurement threw: no spans, no merge — which is why
	// the status has to be carried rather than derived (joshuafolkken/kit#1352).
	[time_batch.FAILED, { span_count: 0, has_ci_data: false }],
])

const MEASURED_HALVES: Halves = { span_count: 2, has_ci_data: true }
const DEFAULTS = {
	status: time_batch.MEASURED,
	elapsed_minutes: 10,
	model_minutes: 1,
	turn_count: 1,
}

function report_of(input: ChildInput): TimeReport {
	const { issue_number, status, elapsed_minutes, model_minutes, turn_count } = {
		...DEFAULTS,
		...input,
	}
	const model_ms = model_minutes * MINUTE_MS
	const halves = HALVES.get(status) ?? MEASURED_HALVES

	return {
		scope: `issue #${String(issue_number)}`,
		started_at: '',
		ended_at: '',
		elapsed_ms: elapsed_minutes * MINUTE_MS,
		span_count: halves.span_count,
		turn_count,
		tool_call_count: 0,
		round_trip_count: 0,
		ms_per_round_trip: 0,
		model_ms_per_round_trip: 0,
		categories: { model_ms, tool_ms: MINUTE_MS, human_ms: MINUTE_MS, ci_ms: MINUTE_MS },
		has_ci_data: halves.has_ci_data,
		notes: [],
		phases: [],
		segments: [],
		by_tool: [],
		by_josh_command: [],
		by_invocation: [],
		by_check: [],

		failures: { ...time_failures.NO_FAILURES },
	}
}

function child_of(input: ChildInput): RunTiming {
	const report = report_of(input)

	return {
		issue_number: input.issue_number,
		// The batch carries `failed` rather than deriving it, so the fixture honors an explicit status
		// too — `HALVES` is what keeps the report from contradicting whichever one is asked for.
		status: input.status ?? time_batch.status_of(report),
		ms_per_turn: report.span_count === 0 ? undefined : time_batch.ms_per_turn_of(report),
		report,
	}
}

function total_of(children: ReadonlyArray<RunTiming>): number {
	let total = 0

	for (const child of children) total += child.report.elapsed_ms

	return total
}

function epic_of(
	children: ReadonlyArray<RunTiming>,
	notes: ReadonlyArray<string> = [],
): EpicTimeReport {
	return {
		scope: `epic #${String(EPIC)}`,
		epic_number: EPIC,
		children: [...children],
		total_ms: total_of(children),
		categories: time_epic.total_categories(children),
		has_transcript_data: children.some((child) => child.report.span_count > 0),
		has_ci_data: children.some((child) => child.report.has_ci_data),
		timed_count: children.filter((child) => time_batch.has_duration(child)).length,
		measured_count: children.filter((child) => child.status === time_batch.MEASURED).length,
		unmeasured_count: time_batch.count_untimed(children),
		trend: time_epic.trend_of(children),
		notes: [...notes],
	}
}

const FIRST_CHILD = child_of({
	issue_number: 101,
	elapsed_minutes: 20,
	model_minutes: 4,
	turn_count: 4,
})
const SECOND_CHILD = child_of({
	issue_number: 102,
	elapsed_minutes: 30,
	model_minutes: 12,
	turn_count: 4,
})
const MEASURED_PAIR = [FIRST_CHILD, SECOND_CHILD]
const NEVER_RUN_CHILD = child_of({ issue_number: 103, status: time_batch.NOT_RUN })
const MERGED_ONLY_CHILD = child_of({ issue_number: 104, status: time_batch.NO_TRANSCRIPT })
const ZERO_MINUTES = '0.0 min'
const SAMPLE_NOTE = '1 child(ren) x'
const NO_TREND_TEXT = 'not enough children recorded a turn'
const FLAT_LINE = 'flat across 2 children'
const READ_FAILED_NOTE = 'the pull request listing could not be read for issue #106'
// What the run scope writes for a child whose two sessions ran at the same wall clock.
const OVERLAP_NOTE =
	'the shares total 20.0 min over a 12.0 min window — 8.0 min of it wall clock concurrent sessions shared, and every share and phase percentage is of the 20.0 min'
// What the run scope writes for a child whose merge was read but whose check list was not.
const CHECK_READ_NOTE =
	'the CI check list could not be read for issue #101 — the per-check table is empty for that reason, not because there were no checks'

function line_with(text: string, needle: string): string {
	return text.split('\n').find((line) => line.includes(needle)) ?? ''
}

describe('time_epic_report.format_epic_report — the batch', () => {
	it('lists every child with its own elapsed time and breakdown', () => {
		const text = time_epic_report.format_epic_report(epic_of(MEASURED_PAIR))

		expect(text).toContain(time_epic_report.CHILD_HEADING)
		expect(text).toContain('#101')
		expect(text).toContain('20.0 min')
		expect(text).toContain('model 4.0 min')
	})

	it('prints the batch total under its own heading', () => {
		const text = time_epic_report.format_epic_report(epic_of(MEASURED_PAIR))

		expect(text).toContain(time_epic_report.CATEGORY_HEADING)
		expect(text).toContain('50.0 min elapsed')
	})

	it('prints the notes the aggregation attached', () => {
		const text = time_epic_report.format_epic_report(epic_of(MEASURED_PAIR, [SAMPLE_NOTE]))

		expect(text).toContain(SAMPLE_NOTE)
	})
})

describe('time_epic_report.format_epic_report — what was not measured', () => {
	// The acceptance criterion this whole scope turns on: a child that never ran must never be rendered as a
	// measured zero, because "was not run" and "took no time" are different answers.
	it('prints a child that never ran as “not run”, never as 0.0 min', () => {
		const text = time_epic_report.format_epic_report(epic_of([FIRST_CHILD, NEVER_RUN_CHILD]))
		const child_row = line_with(text, '#103')

		expect(child_row).toContain(time_batch.NOT_RUN)
		expect(child_row).not.toContain(ZERO_MINUTES)
	})

	// A merge with no transcript knows only the CI wait. Printing `model 0.0 min` there would assert a
	// model wait nobody read — the same measured-zero-for-an-unknown the never-run row above avoids.
	it('withholds the transcript shares for a child whose transcript is missing', () => {
		const text = time_epic_report.format_epic_report(epic_of([MERGED_ONLY_CHILD]))
		const child_row = line_with(text, '#104')

		expect(child_row).toContain('no session transcript')
		expect(child_row).not.toContain(`model ${ZERO_MINUTES}`)
	})

	// The same rule one level up: a batch whose children contributed no transcript has no model,
	// tool or human total, and summing nothing to `0.0 min` would assert one.
	it('withholds the batch shares no child contributed to', () => {
		const text = time_epic_report.format_epic_report(epic_of([MERGED_ONLY_CHILD]))
		const total_row = line_with(text, 'model wait')

		expect(total_row).toContain('not measured')
		expect(total_row).not.toContain(ZERO_MINUTES)
	})
})

describe('time_epic_report.format_epic_report — why a child is short of a measurement', () => {
	// `not run` covers "the batch never reached it" and "the pull request listing could not be read"
	// alike, so the child's own note is what tells them apart — and it has to reach the table.
	it('prints the child’s own note under a row that is short of a measurement', () => {
		const child = child_of({ issue_number: 106, status: time_batch.NOT_RUN })
		const noted = { ...child, report: { ...child.report, notes: [READ_FAILED_NOTE] } }
		const text = time_epic_report.format_epic_report(epic_of([noted]))

		expect(text).toContain(READ_FAILED_NOTE)
	})

	// A measured child needs no explanation, and printing one per row would bury the rows that do.
	it('leaves a fully measured row unqualified', () => {
		const noted = { ...FIRST_CHILD, report: { ...FIRST_CHILD.report, notes: [READ_FAILED_NOTE] } }
		const text = time_epic_report.format_epic_report(epic_of([noted]))

		expect(text).not.toContain(READ_FAILED_NOTE)
	})

	// The one note that is not about the GitHub half: it says the child's own minutes double-count
	// wall clock two of its sessions shared. Every completed child has `has_ci_data`, so the filter
	// above hid it from exactly the rows carrying the inflated figure (joshuafolkken/kit#1330).
	it('prints the overlap note under a fully measured row', () => {
		const noted = { ...FIRST_CHILD, report: { ...FIRST_CHILD.report, notes: [OVERLAP_NOTE] } }
		const text = time_epic_report.format_epic_report(epic_of([noted]))

		// Asserted here so a fixture that stopped being an overlap note fails rather than passing the
		// case by matching nothing.
		expect(time_run.is_overlap_note(OVERLAP_NOTE)).toBe(true)
		expect(text).toContain(OVERLAP_NOTE)
	})

	// The second exception, and the one joshuafolkken/kit#1352's second symptom turns on: a child whose
	// check read was refused *did* read its merge, so the `has_ci_data` filter hid the one sentence
	// saying its empty per-check table is a refusal rather than a run with no checks.
	it('prints the refused-check note under a fully measured row', () => {
		const noted = { ...FIRST_CHILD, report: { ...FIRST_CHILD.report, notes: [CHECK_READ_NOTE] } }
		const text = time_epic_report.format_epic_report(epic_of([noted]))

		expect(time_run.is_check_read_note(CHECK_READ_NOTE)).toBe(true)
		expect(text).toContain(CHECK_READ_NOTE)
	})
})

// A child whose report could not be built at all. `not run` is what it printed before, which is the
// answer for a child the batch never reached — a plausible row for a broken measurement.
describe('time_epic_report.format_epic_report — a report that failed to build', () => {
	it('prints the child as “failed” rather than as one that was never run', () => {
		const failed = child_of({ issue_number: 107, status: time_batch.FAILED })
		const text = time_epic_report.format_epic_report(epic_of([FIRST_CHILD, failed]))
		const child_row = line_with(text, '#107')

		expect(child_row).toContain(time_batch.FAILED)
		expect(child_row).not.toContain(time_batch.NOT_RUN)
		expect(child_row).not.toContain(ZERO_MINUTES)
	})
})

describe('time_epic_report.format_epic_report — an epic with nothing to time', () => {
	// A table of zeroes reads as "this batch took no time", which is never true.
	it('says an epic tracks no children rather than printing an empty table', () => {
		const text = time_epic_report.format_epic_report(epic_of([]))

		expect(text).toContain(time_epic_report.NO_CHILDREN)
		expect(text).not.toContain(time_epic_report.CHILD_HEADING)
	})
})

describe('time_epic_report.format_epic_report — the per-turn trend', () => {
	it('reports the per-turn figure of each child and the direction across them', () => {
		const text = time_epic_report.format_epic_report(epic_of(MEASURED_PAIR))

		expect(text).toContain(time_epic_report.TREND_HEADING)
		expect(text).toContain('60.0 s')
		expect(text).toContain('180.0 s')
		expect(text).toContain('rising 200% across 2 children')
	})

	// `rising 0%` asserts a direction the figure beside it does not show, in the one section the batch
	// scope exists for.
	it('calls two children at the same rate flat, not rising 0%', () => {
		const twin = child_of({ issue_number: 105, model_minutes: 4, turn_count: 4 })
		const text = time_epic_report.format_epic_report(epic_of([FIRST_CHILD, twin]))

		expect(text).toContain(FLAT_LINE)
		expect(text).not.toContain('rising')
	})

	// The case the threshold exists for, which an exactly-equal pair does not exercise: a real change
	// that the printed figure rounds away. `4.00` → `4.01` minutes over 4 turns is 0.25%, which prints
	// as `0%` — so a direction word beside it would assert what the number does not show.
	it('calls a change that rounds away flat too, not rising 0%', () => {
		const nearly = child_of({ issue_number: 105, model_minutes: 4.01, turn_count: 4 })
		const text = time_epic_report.format_epic_report(epic_of([FIRST_CHILD, nearly]))

		expect(text).toContain(FLAT_LINE)
		expect(text).not.toContain('rising')
	})

	it('says a single measured child cannot show a direction', () => {
		const text = time_epic_report.format_epic_report(epic_of([FIRST_CHILD]))

		expect(text).toContain(NO_TREND_TEXT)
		expect(text).not.toContain('% across')
	})

	// The heading stays even when nothing recorded a turn: a reader who came for the trend must be
	// able to tell "measured and flat" from "never measured".
	it('keeps the heading when no child recorded a turn', () => {
		const text = time_epic_report.format_epic_report(epic_of([MERGED_ONLY_CHILD]))

		expect(text).toContain(time_epic_report.TREND_HEADING)
		expect(text).toContain(NO_TREND_TEXT)
	})
})
