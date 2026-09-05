import { describe, expect, it } from 'vitest'
import { time_phase_fixture } from './time-phase-fixture'
import { time_phases } from './time-phases'
import { time_report_fixture } from './time-report-fixture'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'

// How many turns a run had, and where the CI it waited on inside the merge command lands
// (joshuafolkken/kit#1406) — the two figures a hand read of run #1399 disagreed with.
//
// It sits beside `time-report.test.ts` rather than inside it because that file reached its length
// limit — the seam `time-phases-regions.test.ts` was already cut along. Both suites build their run
// through `time-report-fixture.ts`, so neither can come to measure a different run from the other.

const { MINUTE_MS, PNPM_LABEL, build, run_report_of } = time_report_fixture
const { span } = time_span_fixture
const { MERGE_COMMAND, minutes_of: phase_minutes } = time_phase_fixture

// One span of a turn that wrote several lines: the id is what says they were one turn, and it is the
// only field the count reads.
const ONE_MESSAGE = 'msg-1'

function of_turn(category: Span['category']): Span {
	return { ...span(category), message_id: ONE_MESSAGE }
}

describe('time_report.build_report — how many turns a run had', () => {
	// **A turn is an assistant message, not a transcript line.** Claude Code writes one line per
	// content block and repeats the id on each, so the three spans below are one turn — and counting
	// the model spans reported run #1399's 41 turns as 79, halving every per-turn figure divided by it.
	it('counts one turn per assistant message however many spans it wrote', () => {
		const spans = [
			of_turn(time_spans.MODEL_CATEGORY),
			of_turn(time_spans.MODEL_CATEGORY),
			of_turn(time_spans.TOOL_CATEGORY),
		]

		expect(build(spans).turn_count).toBe(1)
	})
})

// `followup --merge` waits for the checks *inside* a Bash span, so that wait is the merge command's
// own execution. The phase table moves it from `merge` to `ci`; a hand read that saw a `ci` row
// beside `CI wait 0.0 min` could take the two for one quantity and conclude the stretch had gone
// unmeasured. These two cases say where it actually is.
const MERGE_MINUTES = 3
const SERIAL_CI_MINUTES = 2
// The whole run is the merge command, so the cycle below is one nothing but that command sat on.
const MERGE_RUN: ReadonlyArray<Span> = [
	{
		...span(time_spans.TOOL_CATEGORY, MERGE_MINUTES, PNPM_LABEL, MERGE_COMMAND),
		ended_ms: MERGE_MINUTES * MINUTE_MS,
	},
]
const WAITED_ON_CI = {
	ci_ms: 0,
	has_ci_data: true,
	windows: [{ started_ms: 0, ended_ms: SERIAL_CI_MINUTES * MINUTE_MS }],
	has_windows: true,
}

describe('time_report.build_from_spans — the CI a run waited on inside the merge command', () => {
	it('leaves the whole merge span in tool execution, with the CI share still zero', () => {
		const report = run_report_of(MERGE_RUN, WAITED_ON_CI)

		expect(report.categories).toEqual({
			model_ms: 0,
			tool_ms: MERGE_MINUTES * MINUTE_MS,
			human_ms: 0,
			ci_ms: 0,
		})
	})

	// The same minutes, moved between two *phases* and between no categories at all — which is why the
	// four shares still reconstruct the elapsed time.
	it('charges the same stretch to the ci phase and takes it out of merge', () => {
		const { phases } = run_report_of(MERGE_RUN, WAITED_ON_CI)

		expect([
			phase_minutes(phases, time_phases.CI_PHASE),
			phase_minutes(phases, time_phases.MERGE_PHASE),
		]).toEqual([SERIAL_CI_MINUTES, MERGE_MINUTES - SERIAL_CI_MINUTES])
	})
})
