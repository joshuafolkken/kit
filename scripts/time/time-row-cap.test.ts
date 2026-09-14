import { time_bundles } from '#scripts/time-runtime/time-bundles'
import { describe, expect, it } from 'vitest'
import type { CheckTotal } from './time-checks'
import { time_cycles } from './time-cycles'
import { time_delegated_wait } from './time-delegated-wait'
import { time_failures } from './time-failures'
import { time_followup_stages } from './time-followup-stages'
import { time_gaps } from './time-gaps'
import { time_gate_runs } from './time-gate-runs'
import { time_investigation } from './time-investigation'
import type { InvocationTotal } from './time-invocations'
import { time_parent_turns } from './time-parent-turns'
import type { TimeReport, ToolTotal } from './time-report'
import { time_rework } from './time-rework'
import { time_row_cap } from './time-row-cap'
import type { Segment } from './time-segments'
import { time_single_checks } from './time-single-checks'
import { time_tool_turns } from './time-tool-turns'
import { time_windows } from './time-windows'

// The row cap as a module (joshuafolkken/kit#1301). The command that reached it — `josh time --top`
// on a run and on an epic — was retired with `josh time`'s additional report scopes
// (joshuafolkken/kit#2017), so the capper itself is what remains, exercised directly rather than
// through a scope.

const MINUTE_MS = 60_000
const ISSUE = 1301
const TOOL_ROWS = 5
const JOSH_ROWS = 3
// The two tables joshuafolkken/kit#1311 added, sized between the other two so a cap equal to one of
// them still cuts the others — which is what the boundary case below reads.
const SEGMENT_ROWS = 4
const INVOCATION_ROWS = 3
const CAP = 2
const SESSION_NOTE = '1 session(s)'
const WITHHELD = 'withheld by --top'

// Built as a per-tool row, which is `by_tool`'s shape since joshuafolkken/kit#1385 and a superset of
// `by_josh_command`'s — so one builder still fills both tables rather than acquiring a second.
function rows(count: number, prefix: string): Array<ToolTotal> {
	return Array.from({ length: count }, (_unused, index) => ({
		label: `${prefix}-${String(index)}`,
		duration_ms: (count - index) * MINUTE_MS,
		call_count: 1,
		round_trip_count: 1,
		alone_in_turn_count: 1,
	}))
}

// The check table carries a conclusion and a merge offset instead of a call count, and the cap is
// asserted to leave it alone — so it is built here in that shape rather than as a tool row.
function check_rows(count: number): Array<CheckTotal> {
	return Array.from({ length: count }, (_unused, index) => ({
		label: `check-${String(index)}`,
		duration_ms: (count - index) * MINUTE_MS,
		conclusion: 'success',
		merge_gap_ms: -MINUTE_MS,
	}))
}

// The segment table is in run order rather than descending, so the cut has to rank the rows itself.
// The **last** segment is the longest here, which is what makes the assertion below meaningful: a cut
// that took the first rows would drop exactly the end of the run `diag` ranks the merge against.
const LONG_SEGMENT_MINUTES = 3

function segment_rows(count: number): Array<Segment> {
	return Array.from({ length: count }, (_unused, index) => ({
		phase: 'implement' as const,
		started_ms: index * MINUTE_MS,
		ended_ms: (index + 1) * MINUTE_MS,
		duration_ms: (index === count - 1 ? LONG_SEGMENT_MINUTES : 1) * MINUTE_MS,
		lead_label: `segment-${String(index)}`,
	}))
}

function invocation_rows(count: number): Array<InvocationTotal> {
	return Array.from({ length: count }, (_unused, index) => ({
		label: `call-${String(index)}`,
		duration_ms: (count - index) * MINUTE_MS,
		call_count: 2,
		durations_ms: [MINUTE_MS, MINUTE_MS],
	}))
}

const NO_BLOCKS = {
	gaps: { ...time_gaps.NO_GAPS },
	bundles: { ...time_bundles.NO_BUNDLES },
	single_checks: { ...time_single_checks.NO_SINGLE_CHECKS },
	gate_runs: { ...time_gate_runs.NO_GATE_RUNS },
	parent_turns: { ...time_parent_turns.NO_PARENT_TURNS },
	investigation: { ...time_investigation.NO_INVESTIGATION },
	followup_stages: { ...time_followup_stages.NO_FOLLOWUP_STAGES },
	rework: { ...time_rework.NO_REWORK },
	failures: { ...time_failures.NO_FAILURES },
}

function report(notes: ReadonlyArray<string> = []): TimeReport {
	return {
		scope: `issue #${String(ISSUE)}`,
		started_at: '',
		ended_at: '',
		elapsed_ms: MINUTE_MS,
		windows: time_windows.NO_WINDOWS,
		span_count: 2,
		turn_count: 1,
		tool_call_count: 1,
		round_trip_count: 1,
		...time_tool_turns.NO_TURN_SPLIT,
		ms_per_round_trip: MINUTE_MS,
		model_ms_per_round_trip: MINUTE_MS,
		categories: { model_ms: MINUTE_MS, tool_ms: 0, human_ms: 0, ci_ms: 0 },
		ci_cycles: { ...time_cycles.NO_CYCLES },
		delegated_wait: { ...time_delegated_wait.NO_WAITS },
		has_ci_data: false,
		notes: [...notes],
		phases: [],
		segments: segment_rows(SEGMENT_ROWS),
		by_tool: rows(TOOL_ROWS, 'tool'),
		by_josh_command: rows(JOSH_ROWS, 'josh'),
		by_invocation: invocation_rows(INVOCATION_ROWS),
		by_check: check_rows(JOSH_ROWS),
		...NO_BLOCKS,
	}
}

function tool_note(kept: number): string {
	return time_row_cap.truncation_note(time_row_cap.TOOL_TABLE, kept, TOOL_ROWS)
}

// Every note a cut of `CAP` produces, in the order the tables are cut — written once so the cases
// below assert against the same list rather than several that could drift apart.
function all_notes(kept: number): Array<string> {
	return [
		tool_note(kept),
		time_row_cap.truncation_note(time_row_cap.JOSH_TABLE, kept, JOSH_ROWS),
		time_row_cap.truncation_note(time_row_cap.SEGMENT_TABLE, kept, SEGMENT_ROWS),
		time_row_cap.truncation_note(time_row_cap.INVOCATION_TABLE, kept, INVOCATION_ROWS),
	]
}

describe('time_row_cap.cap_report — no cap', () => {
	// The acceptance criterion the option is written around: a call that names no cap has to produce
	// exactly what the command produced before this module existed.
	it('returns the very report it was given when no cap was named', () => {
		const built = report()

		expect(time_row_cap.cap_report(built, undefined)).toBe(built)
	})

	it('leaves both tables and the notes untouched when no cap was named', () => {
		const capped = time_row_cap.cap_report(report([SESSION_NOTE]), undefined)

		expect(capped.by_tool).toHaveLength(TOOL_ROWS)
		expect(capped.by_josh_command).toHaveLength(JOSH_ROWS)
		expect(capped.segments).toHaveLength(SEGMENT_ROWS)
		expect(capped.by_invocation).toHaveLength(INVOCATION_ROWS)
		expect(capped.notes).toEqual([SESSION_NOTE])
	})
})

describe('time_row_cap.cap_report — a cap that cuts', () => {
	it('keeps the highest rows of both tables and drops the tail', () => {
		const capped = time_row_cap.cap_report(report(), CAP)

		expect(capped.by_tool.map((row) => row.label)).toEqual(['tool-0', 'tool-1'])
		expect(capped.by_josh_command.map((row) => row.label)).toEqual(['josh-0', 'josh-1'])
	})

	// The segment table is the run's own order, so a cut has to rank before it slices — otherwise the
	// end of the run goes, which is the half `diag` reads the merge and the CI wait out of.
	it('keeps the longest segments, in run order, and the heaviest invocation rows', () => {
		const capped = time_row_cap.cap_report(report(), CAP)

		expect(capped.segments.map((row) => row.lead_label)).toEqual(['segment-0', 'segment-3'])
		expect(capped.by_invocation.map((row) => row.label)).toEqual(['call-0', 'call-1'])
	})

	// A table that silently stops at N reads as "the rest were zero", which is the misreading the
	// whole report withholds its unmeasured rows to prevent.
	it('says how many rows it withheld, per table', () => {
		const capped = time_row_cap.cap_report(report([SESSION_NOTE]), CAP)

		expect(capped.notes).toEqual([SESSION_NOTE, ...all_notes(CAP)])
		expect(capped.notes[1]).toContain(`3 ${WITHHELD}`)
	})

	it('does not mutate the report it was given', () => {
		const built = report()

		time_row_cap.cap_report(built, CAP)

		expect(built.by_tool).toHaveLength(TOOL_ROWS)
		expect(built.notes).toEqual([])
	})

	// Named apart from the two capped tables: its rows are one per CI job, so a cut there hides a
	// check rather than a tail.
	it('leaves the CI check table uncapped', () => {
		expect(time_row_cap.cap_report(report(), CAP).by_check).toHaveLength(JOSH_ROWS)
	})
})

describe('time_row_cap.cap_report — a cap above the row count', () => {
	it('withholds nothing and adds no note when the cap exceeds every table', () => {
		const capped = time_row_cap.cap_report(report([SESSION_NOTE]), TOOL_ROWS + 1)

		expect(capped.by_tool).toHaveLength(TOOL_ROWS)
		expect(capped.by_josh_command).toHaveLength(JOSH_ROWS)
		expect(capped.notes).toEqual([SESSION_NOTE])
	})

	// The boundary: a cap equal to the row count keeps every row, so saying rows were withheld there
	// would be a note about nothing. `JOSH_ROWS` is `INVOCATION_ROWS` too, so two tables sit on it.
	it('adds no note for the tables whose length equals the cap', () => {
		const capped = time_row_cap.cap_report(report(), JOSH_ROWS)

		expect(capped.by_josh_command).toHaveLength(JOSH_ROWS)
		expect(capped.by_invocation).toHaveLength(INVOCATION_ROWS)
		expect(capped.notes).toEqual([
			tool_note(JOSH_ROWS),
			time_row_cap.truncation_note(time_row_cap.SEGMENT_TABLE, JOSH_ROWS, SEGMENT_ROWS),
		])
	})
})
