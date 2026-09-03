import { describe, expect, it } from 'vitest'
import { time_epic, type ChildTiming, type EpicTimeReport } from './time-epic'
import { time_epic_report } from './time-epic-report'
import type { TimeReport } from './time-report'

const MINUTE_MS = 60_000
const EPIC = 1272

interface ChildInput {
	issue_number: number
	status?: ChildTiming['status']
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

const HALVES = new Map<ChildTiming['status'], Halves>([
	[time_epic.MEASURED, { span_count: 2, has_ci_data: true }],
	[time_epic.NO_TRANSCRIPT, { span_count: 0, has_ci_data: true }],
	[time_epic.NOT_MERGED, { span_count: 2, has_ci_data: false }],
	[time_epic.NOT_RUN, { span_count: 0, has_ci_data: false }],
])

const MEASURED_HALVES: Halves = { span_count: 2, has_ci_data: true }
const DEFAULTS = {
	status: time_epic.MEASURED,
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
		categories: { model_ms, tool_ms: MINUTE_MS, human_ms: MINUTE_MS, ci_ms: MINUTE_MS },
		has_ci_data: halves.has_ci_data,
		notes: [],
		phases: [],
		by_tool: [],
		by_josh_command: [],
		by_check: [],
	}
}

function child_of(input: ChildInput): ChildTiming {
	const report = report_of(input)

	return {
		issue_number: input.issue_number,
		status: time_epic.status_of(report),
		ms_per_turn: report.span_count === 0 ? undefined : time_epic.ms_per_turn_of(report),
		report,
	}
}

function total_of(children: ReadonlyArray<ChildTiming>): number {
	let total = 0

	for (const child of children) total += child.report.elapsed_ms

	return total
}

function epic_of(
	children: ReadonlyArray<ChildTiming>,
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
		timed_count: children.filter((child) => child.status !== time_epic.NOT_RUN).length,
		measured_count: children.filter((child) => child.status === time_epic.MEASURED).length,
		unmeasured_count: children.filter((child) => child.status === time_epic.NOT_RUN).length,
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
const NEVER_RUN_CHILD = child_of({ issue_number: 103, status: time_epic.NOT_RUN })
const MERGED_ONLY_CHILD = child_of({ issue_number: 104, status: time_epic.NO_TRANSCRIPT })
const ZERO_MINUTES = '0.0 min'
const SAMPLE_NOTE = '1 child(ren) x'
const NO_TREND_TEXT = 'not enough children recorded a turn'
const FLAT_LINE = 'flat across 2 children'
const READ_FAILED_NOTE = 'the pull request listing could not be read for issue #106'

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

		expect(child_row).toContain(time_epic.NOT_RUN)
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
		const child = child_of({ issue_number: 106, status: time_epic.NOT_RUN })
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
