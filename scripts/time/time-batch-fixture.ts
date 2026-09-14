import { time_bundles } from '#scripts/time-runtime/time-bundles'
import type { CheckTotal } from './time-checks'
import { time_cycles } from './time-cycles'
import { time_delegated_wait } from './time-delegated-wait'
import { time_failures } from './time-failures'
import { time_followup_stages } from './time-followup-stages'
import { time_gaps } from './time-gaps'
import { time_gate_runs } from './time-gate-runs'
import { time_investigation } from './time-investigation'
import { time_parent_turns, type ParentTurnTotals } from './time-parent-turns'
import type { PhaseTotal } from './time-phases'
import type { TimeReport } from './time-report'
import { time_rework } from './time-rework'
import { time_single_checks } from './time-single-checks'
import { time_tool_turns } from './time-tool-turns'
import { time_windows } from './time-windows'

// A report shaped like the one `time_run` hands back, for the batch-classification suite
// (joshuafolkken/kit#1312, joshuafolkken/kit#2017).
//
// It was `time-epic-fixture.ts`'s until `josh time`'s additional report scopes were retired; the
// batch classification it feeds is core rather than a scope's, so the builder outlives the scopes and
// sits under a scope-neutral name. Only the fields `time_batch` reads are varied — building it through
// `time_report.build_from_spans` would need spans these tests have no use for.

const MINUTE_MS = 60_000
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
	phases?: ReadonlyArray<PhaseTotal>
	by_check?: ReadonlyArray<CheckTotal>
	parent_turns?: ParentTurnTotals
}

const DEFAULTS = { model_ms: MINUTE_MS, turn_count: 1, span_count: 2, has_ci_data: true }

// The round-trip figures no batch-classification case reads. Held apart from the report so what a case
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
	| 'ci_cycles'
	| 'delegated_wait'
	| 'gaps'
	| 'bundles'
	| 'single_checks'
	| 'gate_runs'
	| 'investigation'
	| 'parent_turns'
	| 'followup_stages'
	| 'rework'
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
		ci_cycles: { ...time_cycles.NO_CYCLES },
		delegated_wait: { ...time_delegated_wait.NO_WAITS },
		gaps: { ...time_gaps.NO_GAPS },
		bundles: { ...time_bundles.NO_BUNDLES },
		single_checks: { ...time_single_checks.NO_SINGLE_CHECKS },
		gate_runs: { ...time_gate_runs.NO_GATE_RUNS },
		investigation: { ...time_investigation.NO_INVESTIGATION },
		parent_turns: { ...time_parent_turns.NO_PARENT_TURNS },
		followup_stages: { ...time_followup_stages.NO_FOLLOWUP_STAGES },
		rework: { ...time_rework.NO_REWORK },
		failures: { ...time_failures.NO_FAILURES },
	}
}

function breakdown_of(input: ReportInput): Breakdown {
	const empty = empty_breakdown()

	return {
		...empty,
		phases: [...(input.phases ?? [])],
		by_check: [...(input.by_check ?? [])],
		parent_turns: input.parent_turns ?? empty.parent_turns,
	}
}

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
		windows: time_windows.NO_WINDOWS,
		span_count,
		turn_count,
		...ZERO_COUNTS,
		categories: { model_ms, tool_ms: MINUTE_MS, human_ms: 0, ci_ms: 0 },
		has_ci_data,
		...breakdown_of(input),
	}
}

const time_batch_fixture = {
	MINUTE_MS,
	at,
	report_of,
}

export type { ReportInput }
export { time_batch_fixture }
