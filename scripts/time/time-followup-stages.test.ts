import { git_followup_stages } from '#scripts/git/git-followup-stages'
import { describe, expect, it } from 'vitest'
import { time_followup_stages } from './time-followup-stages'
import { time_format } from './time-format'
import { time_report } from './time-report'
import { time_report_fixture } from './time-report-fixture'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'
import { time_transcript_fixture } from './time-transcript-fixture'

const SECOND_MS = 1000
const NO_LAP_YET = 0
const CHECKS_WAIT_SECONDS = 60
const TELEGRAM_SECONDS = 2
const TWO_RUNS = 2
// The blank line, the heading and the one note that open the block.
const ROWS_START = 3

const { STAGE } = git_followup_stages
const { build_followup_stages, followup_stage_lines } = time_followup_stages

const WAITED = [{ name: STAGE.checks_wait, duration_ms: CHECKS_WAIT_SECONDS * SECOND_MS }]
// Printed by the emitter itself rather than typed out here, so the parse is exercised against the
// format the printer actually produces.
const WAITED_BLOCK = git_followup_stages
	.format_stages({ stages: [...WAITED], last_ms: NO_LAP_YET })
	.join('\n')

function followup_span(stages: ReadonlyArray<{ name: string; duration_ms: number }>): Span {
	const span = time_span_fixture.span(
		time_spans.TOOL_CATEGORY,
		1,
		'Bash',
		time_followup_stages.FOLLOWUP_COMMAND,
	)

	return { ...span, followup_stages: [...stages] }
}

function lines_of(spans: ReadonlyArray<Span>): Array<string> {
	return followup_stage_lines(build_followup_stages(spans))
}

describe('time_followup_stages.build_followup_stages', () => {
	it('sums one stage across the invocations that reported it', () => {
		const totals = build_followup_stages([followup_span(WAITED), followup_span(WAITED)])

		expect(totals.run_count).toBe(TWO_RUNS)
		expect(totals.read_count).toBe(TWO_RUNS)
		expect(totals.rows).toEqual([
			{
				label: STAGE.checks_wait,
				duration_ms: TWO_RUNS * CHECKS_WAIT_SECONDS * SECOND_MS,
				run_count: TWO_RUNS,
			},
		])
	})

	// A span split around a delegated unit carries the same rows on both halves, so summing the tail
	// would charge one invocation twice.
	it('drops the continuation half of a call that was split', () => {
		const head = followup_span(WAITED)
		const totals = build_followup_stages([head, { ...head, is_continuation: true }])

		expect(totals.run_count).toBe(1)
	})

	it('counts an invocation whose body carried no readable rows as unread', () => {
		const totals = build_followup_stages([followup_span([])])

		expect(totals.run_count).toBe(1)
		expect(totals.read_count).toBe(0)
	})
})

describe('time_followup_stages.followup_stage_lines', () => {
	// A heading over ten `not measured` rows would assert the question was asked of something.
	it('prints nothing where the window held no followup call', () => {
		expect(lines_of([time_span_fixture.span(time_spans.TOOL_CATEGORY)])).toEqual([])
	})

	it('says not measured, never zero seconds, for an invocation nothing could be read from', () => {
		const printed = lines_of([followup_span([])]).join('\n')

		expect(printed).toContain(time_followup_stages.HEADING)
		expect(printed).toContain(time_format.NOT_MEASURED)
		expect(printed).not.toContain('0.0 s')
		expect(printed).toContain('1 of 1 printed no readable rows')
	})

	// The comparison the table exists for is read down one column across two runs, which a table that
	// reordered itself by duration could not support.
	it('prints every declared stage in run order, measured or not', () => {
		const printed = lines_of([
			followup_span([
				...WAITED,
				{ name: STAGE.telegram, duration_ms: TELEGRAM_SECONDS * SECOND_MS },
			]),
		])
		const labels = printed.slice(ROWS_START).map((line) => line.trim().split(/\s+/u, 1)[0])

		expect(labels).toEqual(Object.values(STAGE))
		expect(printed.join('\n')).toContain(
			time_format.format_seconds(CHECKS_WAIT_SECONDS * SECOND_MS),
		)
		expect(printed.join('\n')).toContain(time_format.NOT_MEASURED)
	})
})

describe('the stage rows survive the transcript parse', () => {
	it('carries what followup printed from the tool result onto the span', () => {
		const { BRANCH } = time_transcript_fixture
		const lines = [
			time_transcript_fixture.prompt_line(0, BRANCH),
			time_transcript_fixture.josh_call_line(1, BRANCH, 'pnpm josh followup "x #1"'),
			time_transcript_fixture.result_line(2, BRANCH, 'a', WAITED_BLOCK),
		]
		const timeline = time_spans.parse_timeline(lines.join('\n'))
		const measured = timeline.spans.filter((span) => span.followup_stages.length > 0)

		expect(measured.map((span) => span.followup_stages[0]?.name)).toEqual([STAGE.checks_wait])
	})
})

describe('time_report.format_report — the followup block', () => {
	it('prints the stage table for a run that called followup', () => {
		const report = time_report_fixture.build([followup_span(WAITED)])
		const printed = time_report.format_report(report)

		expect(printed).toContain(time_followup_stages.HEADING)
		expect(printed).toContain(STAGE.checks_wait)
	})
})
