import { time_markers } from './time-markers'
import type { PhaseName, PhaseTotal } from './time-phases'
import { time_spans, type Span } from './time-spans'

// A span positioned on a clock, for the suites that measure how the phase breakdown *slices* a
// timeline (joshuafolkken/kit#1299).
//
// `time-span-fixture.ts` builds a span by category, which is the question the report and round-trip
// suites ask. This one is the other question: the windows are decided from when a span sits, so a
// test has to read as a timeline rather than as a list of durations. It moved out of
// `time-phases.test.ts` when the region suites joined it and the file passed its length limit —
// a second copy of the builder beside the second suite is the clone `CLAUDE.md` prohibits, in the
// one place a drift would make two suites disagree about what a run looks like.

const MINUTE_MS = 60_000
const NO_CI = { ci_ms: 0, has_ci_data: false }

// The three `pnpm josh <cmd>` names a phase is read off, written once so a suite cannot mistype one
// into a span that then quietly belongs to no command phase at all.
const GATE_COMMAND = 'josh gate'
const PR_COMMAND = 'josh git'
const MERGE_COMMAND = 'josh followup'

// Positioned by start minute so a test reads as a timeline rather than as a list of durations: the
// windows are decided from when a span sits, and a helper that only carried lengths could not say.
function span(start_minute: number, minutes: number, extra: Partial<Span> = {}): Span {
	return {
		category: time_spans.TOOL_CATEGORY,
		label: '',
		josh_command: '',
		marker: time_markers.NO_MARKER,
		branch: 'main',
		outcome: time_spans.UNKNOWN_OUTCOME,
		is_continuation: false,
		ended_ms: (start_minute + minutes) * MINUTE_MS,
		duration_ms: minutes * MINUTE_MS,
		...extra,
	}
}

// A span that closes at a typed prompt — the interval nobody was at the keyboard for. It carries no
// tool name and no marker, exactly as `time-spans.ts` writes one, so a test cannot accidentally rest
// on a combination a transcript never produces.
function waited(start_minute: number, minutes: number): Span {
	return span(start_minute, minutes, { category: time_spans.HUMAN_CATEGORY })
}

function minutes_of(phases: ReadonlyArray<PhaseTotal>, phase: PhaseName): number {
	return (phases.find((total) => total.phase === phase)?.duration_ms ?? 0) / MINUTE_MS
}

function detected(phases: ReadonlyArray<PhaseTotal>, phase: PhaseName): boolean {
	return phases.find((total) => total.phase === phase)?.is_detected === true
}

// What every reconstruction test compares against: the phases must still add up to the elapsed time,
// whichever window a span was moved out of.
function total_ms(phases: ReadonlyArray<PhaseTotal>): number {
	return phases.reduce((sum, entry) => sum + entry.duration_ms, 0)
}

// **The whole-run fixture stays in `time-phases.test.ts` rather than joining these.** It is a
// timeline of bare minute positions, and `@typescript-eslint/no-magic-numbers` is switched off for
// test files only — moved here, every position in it would have to be given a name it does not have.
// The suite that needs a whole run reads it there; the suites here build the few spans they measure.

const time_phase_fixture = {
	MINUTE_MS,
	NO_CI,
	GATE_COMMAND,
	PR_COMMAND,
	MERGE_COMMAND,
	span,
	waited,
	minutes_of,
	detected,
	total_ms,
}

export { time_phase_fixture }
