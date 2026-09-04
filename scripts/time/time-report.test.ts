import { describe, expect, it } from 'vitest'
import { time_phases } from './time-phases'
import { time_report } from './time-report'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span, type Timeline } from './time-spans'

const { MINUTE_MS, span } = time_span_fixture
const SESSION = 'abcd1234'
const PNPM_LABEL = 'Bash: pnpm'

function timeline(spans: ReadonlyArray<Span>): Timeline {
	const elapsed = spans.reduce((sum, entry) => sum + entry.duration_ms, 0)

	return { started_ms: MINUTE_MS, ended_ms: MINUTE_MS + elapsed, spans: [...spans] }
}

function build(spans: ReadonlyArray<Span>): ReturnType<typeof time_report.build_report> {
	return time_report.build_report(SESSION, timeline(spans))
}

const RUN_SCOPE = 'issue #1268'
const SESSION_NOTE = '2 session(s)'
const CI_ROW = 'CI wait'
const CATEGORY_HEADING = 'Where the wall clock went'

const MIXED = [
	span(time_spans.MODEL_CATEGORY, 4),
	span(time_spans.TOOL_CATEGORY, 3, PNPM_LABEL, 'josh gate'),
	span(time_spans.TOOL_CATEGORY, 2, 'Read'),
	span(time_spans.TOOL_CATEGORY, 1, PNPM_LABEL, 'josh lint'),
	span(time_spans.HUMAN_CATEGORY, 10),
]

describe('time_report.build_report — categories', () => {
	it('totals each of the three categories', () => {
		expect(build(MIXED).categories).toEqual({
			model_ms: 4 * MINUTE_MS,
			tool_ms: 6 * MINUTE_MS,
			human_ms: 10 * MINUTE_MS,
			ci_ms: 0,
		})
	})

	it('reports the elapsed time the timeline spans', () => {
		expect(build(MIXED).elapsed_ms).toBe(20 * MINUTE_MS)
	})

	it('dates the session from its first and last event', () => {
		const report = build(MIXED)

		expect(report.started_at).toBe(new Date(MINUTE_MS).toISOString())
		expect(report.ended_at).toBe(new Date(21 * MINUTE_MS).toISOString())
	})

	// One turn per model span, which is what a per-turn figure is divided by
	// (joshuafolkken/kit#1271). Counted here rather than by each caller, because the spans are gone
	// by the time a caller holds a report.
	it('counts one turn per model span, and no others', () => {
		const report = build(MIXED)

		expect(report.turn_count).toBe(1)
		expect(report.span_count).toBe(MIXED.length)
	})
})

describe('time_report.build_report — per-label totals', () => {
	it('bundles repeated calls of one label and counts them', () => {
		expect(build(MIXED).by_tool).toEqual([
			{ label: PNPM_LABEL, duration_ms: 4 * MINUTE_MS, call_count: 2 },
			{ label: 'Read', duration_ms: 2 * MINUTE_MS, call_count: 1 },
		])
	})

	// Descending by time, not by name: the row a reader is looking for is the expensive one.
	it('orders the rows by time spent, descending', () => {
		const rows = build([
			span(time_spans.TOOL_CATEGORY, 1, 'Aaa'),
			span(time_spans.TOOL_CATEGORY, 9, 'Zzz'),
		]).by_tool

		expect(rows.map((row) => row.label)).toEqual(['Zzz', 'Aaa'])
	})

	it('splits the josh subcommands apart from the tool that ran them', () => {
		expect(build(MIXED).by_josh_command).toEqual([
			{ label: 'josh gate', duration_ms: 3 * MINUTE_MS, call_count: 1 },
			{ label: 'josh lint', duration_ms: MINUTE_MS, call_count: 1 },
		])
	})

	// Every span carries a category but only tool spans carry a label, so an empty label is not a
	// bucket — printed as one it would report a total nobody measured.
	it('never opens a bucket for an unlabelled span', () => {
		const report = build([span(time_spans.MODEL_CATEGORY, 4)])

		expect(report.by_tool).toEqual([])
		expect(report.by_josh_command).toEqual([])
	})
})

describe('time_report.format_report', () => {
	it('prints the three categories with their share of the elapsed time', () => {
		const text = time_report.format_report(build(MIXED))

		expect(text).toContain(time_report.MODEL_LABEL)
		expect(text).toContain('20.0%')
		expect(text).toContain('50.0%')
	})

	it('prints the two tables under their own headings', () => {
		const text = time_report.format_report(build(MIXED))

		expect(text).toContain('By tool (descending):')
		expect(text).toContain('By josh command (descending):')
	})

	// A long run touches thirty-odd distinct leading commands. The cap keeps the table readable and
	// says how many rows it withheld, because a silently truncated table is read as a complete one.
	it('caps the rows and says how many it withheld', () => {
		const many = Array.from({ length: time_report.MAX_ROWS + 3 }, (_, index) =>
			span(time_spans.TOOL_CATEGORY, index + 1, `tool-${String(index)}`),
		)

		expect(time_report.format_report(build(many))).toContain('… and 3 more')
	})

	// A table of zeroes reads as "this run took no time", which is never true.
	it('says a transcript has no timed lines instead of printing zeroes', () => {
		const text = time_report.format_report(build([]))

		expect(text).toContain('no timed lines')
		expect(text).not.toContain(CATEGORY_HEADING)
	})
})

function run_report(
	spans: ReadonlyArray<Span>,
	ci_ms: number,
): ReturnType<typeof time_report.build_from_spans> {
	return time_report.build_from_spans({
		scope: RUN_SCOPE,
		spans,
		started_ms: 0,
		ended_ms: 30 * MINUTE_MS,
		ci_ms,
		has_ci_data: true,
		notes: [SESSION_NOTE],
		by_check: [{ label: 'unit', duration_ms: 2 * MINUTE_MS, call_count: 1 }],
	})
}

// The fourth share exists only where a pull request was read. A session report has none, and
// printing `CI wait 0.0 min` there would assert a measurement nobody made.
describe('time_report.build_from_spans — the CI share', () => {
	it('adds the CI wait to the elapsed time rather than to a category', () => {
		const report = run_report(MIXED, 5 * MINUTE_MS)

		expect(report.categories.ci_ms).toBe(5 * MINUTE_MS)
		expect(report.elapsed_ms).toBe(25 * MINUTE_MS)
	})

	it('prints the CI row, the notes and the check table', () => {
		const text = time_report.format_report(run_report(MIXED, 5 * MINUTE_MS))

		expect(text).toContain(RUN_SCOPE)
		expect(text).toContain(CI_ROW)
		expect(text).toContain(SESSION_NOTE)
		expect(text).toContain('By CI check (descending, jobs overlap):')
	})

	it('withholds the CI row from a session report, which measured none', () => {
		expect(time_report.format_report(build(MIXED))).not.toContain(CI_ROW)
	})

	// A run whose transcripts are all missing still has a measured CI wait, and reporting that as
	// "no timed lines" would throw away the one figure GitHub did answer.
	it('reports a run with no spans but a known CI wait', () => {
		const text = time_report.format_report(run_report([], MINUTE_MS))

		expect(text).toContain(CATEGORY_HEADING)
	})
})

// **The three transcript shares are an unknown there, not a zero** (joshuafolkken/kit#1295). Nothing
// was read, so `model wait 0.0 min` beside `CI wait 1.0 min 100.0%` reads as a run that spent its
// whole length in CI — the measured zero standing in for an unknown this table exists to prevent.
const TRANSCRIPT_ROWS = [time_report.MODEL_LABEL, time_report.TOOL_LABEL, time_report.HUMAN_LABEL]
const WHOLE_SHARE = '100.0%'

// The state under test: a merged pull request whose session transcripts could not be attributed, so
// the CI wait is the only half that was read.
function unread(): string {
	return time_report.format_report(run_report([], MINUTE_MS))
}

describe('time_report.format_report — a run with no transcript read', () => {
	it('withholds each transcript share instead of printing a zero', () => {
		const rows = unread()
			.split('\n')
			.filter((line) => TRANSCRIPT_ROWS.some((label) => line.includes(label)))

		expect(rows).toHaveLength(TRANSCRIPT_ROWS.length)
		expect(rows.every((line) => line.includes(time_report.NOT_MEASURED))).toBe(true)
		expect(rows.some((line) => line.includes('0.0 min'))).toBe(false)
	})

	// The CI wait is the one half that *was* read, so it keeps its figure and its share — the printed
	// arithmetic still reconstructs the elapsed time rather than being withheld along with the rest.
	it('keeps the CI row it did measure', () => {
		expect(unread()).toContain(time_report.format_row(CI_ROW, MINUTE_MS, WHOLE_SHARE))
	})

	// The `wait` phase and the `human wait` category are the same quantity read two ways, so they are
	// withheld together — the cross-check joshuafolkken/kit#1290 left the report resting on.
	it('withholds the wait phase alongside the human wait category', () => {
		expect(unread()).toContain(
			time_report.format_columns(time_phases.WAIT_PHASE, '', time_report.NOT_DETECTED),
		)
	})

	// A run whose transcript *was* read and simply waited on nobody keeps its measured zero: "nothing
	// was read" and "read, and genuinely zero" are the two answers this row has to keep apart.
	it('still prints a measured zero where the transcript was read', () => {
		const spans = [span(time_spans.MODEL_CATEGORY, 4), span(time_spans.TOOL_CATEGORY, 6)]
		const text = time_report.format_report(run_report(spans, MINUTE_MS))

		expect(text).toContain(time_report.format_row(time_report.HUMAN_LABEL, 0, '0.0%'))
		expect(text).not.toContain(time_report.NOT_MEASURED)
	})
})

describe('time_report — the phase breakdown', () => {
	it('prints the phases under their own heading', () => {
		const text = time_report.format_report(build(MIXED))

		expect(text).toContain(time_report.PHASE_HEADING)
		expect(text).toContain(time_phases.GATE_PHASE)
	})

	// A measured zero would assert that the phase did not run, which is the one thing the transcript
	// cannot say when its boundary marker never appeared.
	it('prints a phase whose marker never appeared as not detected', () => {
		const text = time_report.format_report(build(MIXED))

		// Laid out through the same three columns as a measured row, so the words sit where the share
		// would rather than overrunning the duration column.
		expect(text).toContain(
			`  ${time_phases.PLAN_PHASE}${' '.repeat(32)}${time_report.NOT_DETECTED}`,
		)
	})

	it('gives a detected phase its share of the elapsed time', () => {
		const text = time_report.format_report(build(MIXED))

		expect(text).toContain('3.0 min   15.0%')
	})

	it('carries the same breakdown into the machine-readable report', () => {
		const { phases } = build(MIXED)

		expect(phases.map((phase) => phase.phase)).toEqual([...time_phases.PHASE_ORDER])
	})

	it('reconstructs the elapsed time from the phases alone', () => {
		const report = run_report(MIXED, 5 * MINUTE_MS)
		const total = report.phases.reduce((sum, phase) => sum + phase.duration_ms, 0)

		expect(total).toBe(report.elapsed_ms)
	})
})

// joshuafolkken/kit#1304. `MIXED` is one turn issuing three calls at once, which is the shape the
// rule asks for; `SERIAL` is the same work one call per turn, which is the shape every run measured
// on that issue actually had.
const SERIAL = [
	span(time_spans.MODEL_CATEGORY, 1),
	span(time_spans.TOOL_CATEGORY, 1, PNPM_LABEL),
	span(time_spans.MODEL_CATEGORY, 1),
	span(time_spans.TOOL_CATEGORY, 1, PNPM_LABEL),
]
const DENSITY_SUFFIX = time_report.PER_ROUND_TRIP

// The one row a case is about, so an assertion cannot pass on a word another row happens to carry —
// `no tool call to divide` is printed by the trips row and the cost row alike.
function line_of(text: string, label: string): string {
	return text.split('\n').find((row) => row.includes(label)) ?? ''
}

describe('time_report.format_report — the round-trip block', () => {
	it('reports the calls, the trips they were issued in and the turns they sat in', () => {
		const text = time_report.format_report(build(MIXED))

		expect(text).toContain(time_report.ROUND_TRIP_HEADING)
		expect(text).toContain(`3.00 ${DENSITY_SUFFIX}`)
		expect(text).toContain('over 1 turn(s)')
	})

	it('leaves a run that batched its calls unflagged', () => {
		expect(time_report.format_report(build(MIXED))).not.toContain(time_report.BATCHING_WARNING)
	})

	it('flags a run that issued one call per turn', () => {
		const text = time_report.format_report(build(SERIAL))

		expect(text).toContain(`1.00 ${DENSITY_SUFFIX}`)
		expect(text).toContain(time_report.BATCHING_WARNING)
	})

	it('carries both counts into the machine-readable report', () => {
		const report = build(MIXED)

		expect(report.tool_call_count).toBe(3)
		expect(report.round_trip_count).toBe(1)
	})
})

// joshuafolkken/kit#1307. The counts above say how often a run went round; these say what one of
// those trips cost, which is what a proposed cut is multiplied by.
describe('time_report.format_report — the price of a round trip', () => {
	// `MIXED` is one turn of 4 minutes issuing three calls that run for 6, and then a 10-minute human
	// wait. The single round trip is priced at the 10 minutes it was made of; the wait is nobody's
	// round trip and stays out of the numerator.
	it('prices one round trip beside the counts', () => {
		const text = time_report.format_report(build(MIXED))

		expect(line_of(text, time_report.COST_LABEL)).toContain('600.0 s')
		expect(line_of(text, time_report.COST_LABEL)).toContain(`${time_report.MODEL_LABEL} 240.0 s`)
	})

	it('carries the unit price into the machine-readable report', () => {
		const report = build(MIXED)

		expect(report.ms_per_round_trip).toBe(10 * MINUTE_MS)
		expect(report.model_ms_per_round_trip).toBe(4 * MINUTE_MS)
	})

	// A run's elapsed time includes what nobody's round trip caused, so a price built from it would be
	// multiplied out as a saving and then counted again against the `wait` row of the same table.
	it('keeps the human wait out of the price', () => {
		const report = build(MIXED)

		expect(report.elapsed_ms).toBe(20 * MINUTE_MS)
		expect(report.ms_per_round_trip).toBeLessThan(report.elapsed_ms)
	})
})

// The block's three rows are withheld together, on one criterion each, because a measured zero in
// any of them asserts something nobody established: no batching to grade, or no tool called at all.
describe('time_report.format_report — the round-trip block withholds rather than zeroes', () => {
	// The division answers `0` for a transcript that was read and called no tool, which is the same
	// value an unread one produces. Printed as a density it would grade a scope that did no batching
	// to grade, and printed as a price it would report a run whose every turn was instantaneous.
	it('says there was nothing to divide rather than printing a density or a price of zero', () => {
		const report = build([span(time_spans.MODEL_CATEGORY, 1)])
		const text = time_report.format_report(report)

		expect(report.ms_per_round_trip).toBe(0)
		expect(line_of(text, time_report.COST_LABEL)).toContain(time_report.NO_CALLS)
		expect(text).not.toContain(DENSITY_SUFFIX)
		expect(text).not.toContain(time_report.BATCHING_WARNING)
	})

	// The same criterion the three category shares are withheld on (joshuafolkken/kit#1295): a run
	// whose transcript was not read has no round trips, and `0` there reads as a run that called no
	// tool at all rather than as one nobody measured.
	it('says the counts and the price were not measured where no span was read', () => {
		const text = time_report.format_report(run_report([], MINUTE_MS))

		expect(text).toContain(time_report.CALLS_LABEL)
		expect(text).toContain(time_report.TRIPS_LABEL)
		expect(line_of(text, time_report.COST_LABEL)).toContain(time_report.NOT_MEASURED)
		expect(text).not.toContain(DENSITY_SUFFIX)
	})
})

describe('time_report.format_share', () => {
	it('answers n/a rather than dividing by an elapsed time of zero', () => {
		expect(time_report.format_share(0, 0)).toBe('n/a')
	})
})

describe('time_report.format_minutes', () => {
	it('prints milliseconds as minutes to one decimal', () => {
		expect(time_report.format_minutes(90 * 1000)).toBe('1.5 min')
	})
})
