import { time_markers } from './time-markers'
import type { Span } from './time-spans'

// Cutting the same elapsed time by workflow phase rather than by what was waited on
// (joshuafolkken/kit#1269).
//
// Epic #1262's split rationale — "verification commands 465s / code review 326s / edits and format
// hook 143s / CI wait and merge 125s" — was built by classifying one run's transcript by hand, and
// reproducing it cost the same hand work every time. This is that classification, decided from the
// boundary markers `time-markers.ts` names and never from how long an interval happened to be.
//
// **Two shapes of phase, and the difference is not cosmetic.** `gate`, `review`, `pr` and `merge`
// are the spans of a recognizable command, so they are collected wherever they fall — which is what
// keeps the gate correct now that it is *started beside* the review rather than in front of it, and
// a sequential state machine could not have expressed that overlap. `plan` and `implement` name no
// single command, so they are windows between two markers.
//
// **`other` is the remainder, and it is kept rather than discarded.** Every span lands in exactly
// one phase and the CI share is disjoint from all of them by construction, so the phases still
// reconstruct the elapsed time exactly — the property that makes two runs comparable, and the one a
// breakdown that quietly dropped its leftovers would have broken.

type PhaseName = 'plan' | 'implement' | 'gate' | 'review' | 'pr' | 'ci' | 'merge' | 'other'

const PLAN_PHASE: PhaseName = 'plan'
const IMPLEMENT_PHASE: PhaseName = 'implement'
const GATE_PHASE: PhaseName = 'gate'
const REVIEW_PHASE: PhaseName = 'review'
const PR_PHASE: PhaseName = 'pr'
const CI_PHASE: PhaseName = 'ci'
const MERGE_PHASE: PhaseName = 'merge'
const OTHER_PHASE: PhaseName = 'other'

// Run order, which is the order they are printed in. `other` is last because it is a remainder
// rather than a stage anything passes through.
const PHASE_ORDER: ReadonlyArray<PhaseName> = [
	PLAN_PHASE,
	IMPLEMENT_PHASE,
	GATE_PHASE,
	REVIEW_PHASE,
	PR_PHASE,
	CI_PHASE,
	MERGE_PHASE,
	OTHER_PHASE,
]

const GATE_COMMAND = 'josh gate'
const NO_DURATION = 0

// The `pnpm josh <cmd>` names `time-spans.ts` already reads off a Bash call, mapped to the phase
// each one *is*. Read from that field rather than re-detected here, so what counts as a gate run is
// one rule and not two.
const COMMAND_PHASES = new Map<string, PhaseName>([
	[GATE_COMMAND, GATE_PHASE],
	['josh git', PR_PHASE],
	['josh pr', PR_PHASE],
	['josh followup', MERGE_PHASE],
])

interface PhaseTotal {
	phase: PhaseName
	duration_ms: number
	// Whether the phase's boundary marker was seen at all. **Not the same as a non-zero total**: a
	// phase that never ran and a phase whose marker this transcript could not be read for both total
	// zero, and only this flag tells them apart. The report prints "not detected" rather than
	// `0.0 min` for the difference.
	is_detected: boolean
}

interface PhaseInput {
	spans: ReadonlyArray<Span>
	ci_ms: number
	has_ci_data: boolean
}

// `undefined` means the marker never appeared, which is the phase's "not detected" answer. A
// sentinel instant would be indistinguishable from a real one at the epoch.
interface Windows {
	plan_end_ms: number | undefined
	implement_start_ms: number | undefined
	implement_end_ms: number
}

interface Detection {
	windows: Windows
	totals: ReadonlyMap<PhaseName, number>
	has_ci_data: boolean
}

function started_ms(span: Span): number {
	return span.ended_ms - span.duration_ms
}

// Earliest by *start*, not by position: the spans reaching here have been merged across sessions and
// deduplicated, so file order says nothing about time.
function first_by(spans: ReadonlyArray<Span>, is_match: (span: Span) => boolean): Span | undefined {
	return spans
		.filter((span) => is_match(span))
		.toSorted((left, right) => started_ms(left) - started_ms(right))[0]
}

function is_gate(span: Span): boolean {
	return span.josh_command === GATE_COMMAND
}

function run_end_ms(spans: ReadonlyArray<Span>): number {
	let latest = NO_DURATION

	for (const span of spans) latest = Math.max(latest, span.ended_ms)

	return latest
}

// A command's own phase, which wins over whichever window the span sits in. Without that precedence
// the gate spans now running beside the review would be charged to the review.
function command_phase(span: Span): PhaseName | undefined {
	if (span.marker === time_markers.REVIEW_MARKER) return REVIEW_PHASE

	return COMMAND_PHASES.get(span.josh_command)
}

function is_after(span: Span, start_ms: number | undefined): boolean {
	return start_ms === undefined || started_ms(span) >= start_ms
}

function ends_before(span: Span, start_ms: number | undefined): boolean {
	return start_ms === undefined || span.ended_ms <= start_ms
}

// **The plan comment has to close before the work started to be one.** The same
// `gh api …/issues/<N>/comments -f body=…` shape writes an auto-decision log and a follow-up filing,
// and a run whose Issue body was already filled posts no plan comment at all — so the earliest match
// in such a run sits near the *end*, and everything in front of it would be reported as planning.
// The condition is also what makes the two windows provably disjoint rather than assumed to be.
function plan_end_of(spans: ReadonlyArray<Span>, start_ms: number | undefined): number | undefined {
	const is_plan_marker = (span: Span): boolean =>
		span.marker === time_markers.PLAN_MARKER && ends_before(span, start_ms)

	return first_by(spans, is_plan_marker)?.ended_ms
}

// The first gate that starts after implementation opened, falling back to the end of what was
// measured when none did. **Taking the first gate outright inverted the window**: a resumed session
// that gated the previous issue, or a baseline run before any edit, closed it before it opened, and
// every implementation span then fell out of a phase still reported as detected — a confident
// `0.0 min` in exactly the place `is_detected` exists to keep honest.
function implement_end_of(spans: ReadonlyArray<Span>, start_ms: number | undefined): number {
	const gate = first_by(spans, (span) => is_gate(span) && is_after(span, start_ms))

	return gate === undefined ? run_end_ms(spans) : started_ms(gate)
}

// The first instant the run had demonstrably moved past planning. **The first edit is not enough on
// its own**: a run whose file changes went through Bash — `sed -i` and the like — records no edit
// marker at all, and with no bound the guard above accepts any plan-shaped call anywhere, so that
// run's *completion* comment closed a planning phase covering nearly the whole of it. The first
// command phase is the second bound, and either one alone answers the question the guard asks.
function work_start_of(spans: ReadonlyArray<Span>, edit: Span | undefined): number | undefined {
	const command = first_by(spans, (span) => command_phase(span) !== undefined)
	const marks = [edit, command]
		.filter((span): span is Span => span !== undefined)
		.map((span) => started_ms(span))

	return marks.length === 0 ? undefined : Math.min(...marks)
}

function build_windows(spans: ReadonlyArray<Span>): Windows {
	const edit = first_by(spans, (span) => span.marker === time_markers.EDIT_MARKER)
	const implement_start_ms = edit === undefined ? undefined : started_ms(edit)

	return {
		plan_end_ms: plan_end_of(spans, work_start_of(spans, edit)),
		implement_start_ms,
		implement_end_ms: implement_end_of(spans, implement_start_ms),
	}
}

function is_implementing(span: Span, windows: Windows): boolean {
	const { implement_start_ms } = windows

	if (implement_start_ms === undefined) return false

	return started_ms(span) >= implement_start_ms && started_ms(span) < windows.implement_end_ms
}

function is_planning(span: Span, windows: Windows): boolean {
	const { plan_end_ms } = windows

	return plan_end_ms !== undefined && span.ended_ms <= plan_end_ms
}

// The order the two are tested in does not matter: `plan_end_of` accepts no marker that closes after
// implementation opens, so the windows are disjoint by construction rather than by assumption.
function window_phase(span: Span, windows: Windows): PhaseName {
	if (is_implementing(span, windows)) return IMPLEMENT_PHASE

	return is_planning(span, windows) ? PLAN_PHASE : OTHER_PHASE
}

function span_phase(span: Span, windows: Windows): PhaseName {
	return command_phase(span) ?? window_phase(span, windows)
}

function totals_of(spans: ReadonlyArray<Span>, windows: Windows): Map<PhaseName, number> {
	const totals = new Map<PhaseName, number>()

	for (const span of spans) {
		const phase = span_phase(span, windows)

		totals.set(phase, (totals.get(phase) ?? NO_DURATION) + span.duration_ms)
	}

	return totals
}

// `other` is always detected because it is the remainder rather than a marker, and `ci` is detected
// exactly when the GitHub half was read — the same flag the CI category row is withheld on, so the
// two halves of the report cannot disagree about whether a merge was seen.
function is_marker_detected(phase: PhaseName, found: Detection): boolean {
	if (phase === CI_PHASE) return found.has_ci_data

	return phase === OTHER_PHASE || found.totals.has(phase)
}

function is_detected(phase: PhaseName, found: Detection): boolean {
	const { windows } = found

	if (phase === PLAN_PHASE) return windows.plan_end_ms !== undefined
	if (phase === IMPLEMENT_PHASE) return windows.implement_start_ms !== undefined

	return is_marker_detected(phase, found)
}

// The CI share is not a span total: it is the part of the pull request's open→merge window no
// transcript span covers, computed by `time-run.ts` and handed in.
function duration_of(phase: PhaseName, found: Detection, ci_ms: number): number {
	return phase === CI_PHASE ? ci_ms : (found.totals.get(phase) ?? NO_DURATION)
}

function build_phases(input: PhaseInput): Array<PhaseTotal> {
	const windows = build_windows(input.spans)
	const found: Detection = {
		windows,
		totals: totals_of(input.spans, windows),
		has_ci_data: input.has_ci_data,
	}

	return PHASE_ORDER.map((phase) => ({
		phase,
		duration_ms: duration_of(phase, found, input.ci_ms),
		is_detected: is_detected(phase, found),
	}))
}

const time_phases = {
	PHASE_ORDER,
	PLAN_PHASE,
	IMPLEMENT_PHASE,
	GATE_PHASE,
	REVIEW_PHASE,
	PR_PHASE,
	CI_PHASE,
	MERGE_PHASE,
	OTHER_PHASE,
	build_phases,
}

export type { PhaseInput, PhaseName, PhaseTotal }
export { time_phases }
