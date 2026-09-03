import { time_markers } from './time-markers'
import { time_spans, type Span } from './time-spans'

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
// a sequential state machine could not have expressed that overlap. `plan`, `implement` and
// `rework` name no single command, so they are windows between two markers.
//
// **`other` is the remainder, and it is kept rather than discarded.** Every span lands in exactly
// one phase and the CI share is disjoint from all of them by construction, so the phases still
// reconstruct the elapsed time exactly — the property that makes two runs comparable, and the one a
// breakdown that quietly dropped its leftovers would have broken.
//
// **`rework` is the second window, and it exists because `implement` ends at the first gate**
// (joshuafolkken/kit#1281). A real run is edit → gate → fix what it caught → gate again → review →
// fix what *that* caught, so with one window everything past the first gate fell into `other` —
// 35.7% of the documented sample run, against 3.0 minutes of `implement`. The totals still
// reconstructed elapsed time exactly, so it was never an arithmetic defect; it under-reported
// implementation to the one question the breakdown exists to answer.
//
// **A window collects intervals, and waiting for a person is an interval** (joshuafolkken/kit#1290).
// So every window phase used to charge itself the time nobody was at the keyboard: the documented
// sample run is 39.4% human wait, and `plan`'s 32.4 minutes carried much of it. `rework` shows it
// most reliably, because its window falls back to the end of what was measured when no pull request
// was opened and the archetypal run that opens none is a `halfrun`, which stops after the gate and
// waits for a person **by specification** — so exactly where the fallback applies, the wait is
// charged to `rework` in full and the row reports how long somebody waited rather than how long the
// rework took.
//
// **`wait` is a phase of its own rather than a share of `other`.** A run that stalls on a person is
// a fact about the run, and folding it into the remainder hides it behind whatever else landed
// there. Every human span carries `NO_CALL` — the closing event is a typed prompt, which names no
// tool — so none of them was ever in a command phase, and moving all of them here leaves `gate`,
// `review`, `pr` and `merge` untouched while making `wait` equal to the human-wait category exactly.
// That equality is the invariant, and it is what lets the two halves of the report cross-check.

type PhaseName =
	'plan' | 'implement' | 'gate' | 'rework' | 'review' | 'pr' | 'ci' | 'merge' | 'wait' | 'other'

const PLAN_PHASE: PhaseName = 'plan'
const IMPLEMENT_PHASE: PhaseName = 'implement'
const GATE_PHASE: PhaseName = 'gate'
const REWORK_PHASE: PhaseName = 'rework'
const REVIEW_PHASE: PhaseName = 'review'
const PR_PHASE: PhaseName = 'pr'
const CI_PHASE: PhaseName = 'ci'
const MERGE_PHASE: PhaseName = 'merge'
const WAIT_PHASE: PhaseName = 'wait'
const OTHER_PHASE: PhaseName = 'other'

// Run order, which is the order they are printed in. `wait` and `other` come last because neither is
// a stage anything passes through: one is time spent between the stages, the other the remainder.
const PHASE_ORDER: ReadonlyArray<PhaseName> = [
	PLAN_PHASE,
	IMPLEMENT_PHASE,
	GATE_PHASE,
	REWORK_PHASE,
	REVIEW_PHASE,
	PR_PHASE,
	CI_PHASE,
	MERGE_PHASE,
	WAIT_PHASE,
	OTHER_PHASE,
]

// Neither is a boundary marker, so neither can fail to be found: `other` is the remainder, and `wait`
// is read off the span's own category. A run nobody waited on genuinely waited zero minutes, which is
// the one answer `not detected` must not be given for.
//
// **`wait` is detected on exactly the terms the `human wait` category row is printed on**, which is
// unconditionally — so a run with no transcript attributed shows `0.0 min` in both, and the two agree.
// Withholding the phase there while the category above it still printed a zero would make one report
// contradict itself, which is worse than the shared imprecision; whether *either* should be withheld
// when nothing was read is a question about the whole table and predates this phase.
const ALWAYS_DETECTED_PHASES: ReadonlySet<PhaseName> = new Set([WAIT_PHASE, OTHER_PHASE])

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
	// Where `implement` closed, read a second time as where `rework` opens. `undefined` means no gate
	// ran **after implementation opened** — a resumed session that gated the previous issue before this
	// one's first edit has one in its transcript and still answers `undefined`, exactly as `implement`
	// already refuses that gate as its own boundary. It is the only state in which the two differ:
	// `implement_end_ms` then falls back to the end of what was measured, and `rework` is reported as
	// never having been reached rather than as zero minutes long.
	rework_start_ms: number | undefined
	rework_end_ms: number
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

// The first gate that starts after implementation opened. **Taking the first gate outright inverted
// the window**: a resumed session that gated the previous issue, or a baseline run before any edit,
// closed it before it opened, and every implementation span then fell out of a phase still reported
// as detected — a confident `0.0 min` in exactly the place `is_detected` exists to keep honest.
function first_gate_of(
	spans: ReadonlyArray<Span>,
	start_ms: number | undefined,
): number | undefined {
	const gate = first_by(spans, (span) => is_gate(span) && is_after(span, start_ms))

	return gate === undefined ? undefined : started_ms(gate)
}

// **Rework closes where the pull request opens, not where the review starts.** Closing it at the
// review would send every fix the review itself demanded straight back into `other` — the same
// defect one stage further along, since a `fullrun` fixes what round one found and then re-reviews.
// `josh git` / `josh pr` is the first instant the run demonstrably stopped changing code, and it is
// a command name rather than a duration, so the boundary does not move when a run gets faster.
// Falling back to the end of what was measured covers a run that stopped before its pull request.
function rework_end_of(spans: ReadonlyArray<Span>, start_ms: number | undefined): number {
	const opened = first_by(
		spans,
		(span) => command_phase(span) === PR_PHASE && is_after(span, start_ms),
	)

	return opened === undefined ? run_end_ms(spans) : started_ms(opened)
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
	const rework_start_ms = first_gate_of(spans, implement_start_ms)

	return {
		plan_end_ms: plan_end_of(spans, work_start_of(spans, edit)),
		implement_start_ms,
		implement_end_ms: rework_start_ms ?? run_end_ms(spans),
		rework_start_ms,
		rework_end_ms: rework_end_of(spans, rework_start_ms),
	}
}

// Half-open, and classified by where a span *starts*, so one interval cannot be charged to two
// windows. `undefined` is the window that never opened — a run with no edit, or one with no gate —
// which is not the same answer as a window that opened and stayed empty.
//
// One test for both windows rather than one each: implementation and rework are the same question
// asked about two pairs of instants, and two copies of it would drift apart the first time one
// changed.
function is_within(span: Span, start_ms: number | undefined, end_ms: number): boolean {
	if (start_ms === undefined) return false

	return started_ms(span) >= start_ms && started_ms(span) < end_ms
}

function is_planning(span: Span, windows: Windows): boolean {
	const { plan_end_ms } = windows

	return plan_end_ms !== undefined && span.ended_ms <= plan_end_ms
}

// The order the three are tested in does not matter. Implementation and rework meet at the first
// gate and never overlap, and `plan_end_of` accepts no marker that closes after implementation
// opens — so the windows are disjoint by construction rather than by assumption.
function window_phase(span: Span, windows: Windows): PhaseName {
	const { implement_start_ms, implement_end_ms, rework_start_ms, rework_end_ms } = windows

	if (is_within(span, implement_start_ms, implement_end_ms)) return IMPLEMENT_PHASE
	if (is_within(span, rework_start_ms, rework_end_ms)) return REWORK_PHASE

	return is_planning(span, windows) ? PLAN_PHASE : OTHER_PHASE
}

// **Waiting is decided before anything else, because it is not work.** A human span closes at a
// typed prompt and so carries no command, which means the tests below would have sent every one of
// them to a window or to `other` — and a window that collects them stops answering how long its
// stage took.
function span_phase(span: Span, windows: Windows): PhaseName {
	if (span.category === time_spans.HUMAN_CATEGORY) return WAIT_PHASE

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

// `wait` and `other` are always detected because neither rests on a marker, and `ci` is detected
// exactly when the GitHub half was read — the same flag the CI category row is withheld on, so the
// two halves of the report cannot disagree about whether a merge was seen.
function is_marker_detected(phase: PhaseName, found: Detection): boolean {
	if (phase === CI_PHASE) return found.has_ci_data

	return ALWAYS_DETECTED_PHASES.has(phase) || found.totals.has(phase)
}

function is_detected(phase: PhaseName, found: Detection): boolean {
	const { windows } = found

	if (phase === PLAN_PHASE) return windows.plan_end_ms !== undefined
	if (phase === IMPLEMENT_PHASE) return windows.implement_start_ms !== undefined
	if (phase === REWORK_PHASE) return windows.rework_start_ms !== undefined

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
	REWORK_PHASE,
	REVIEW_PHASE,
	PR_PHASE,
	CI_PHASE,
	MERGE_PHASE,
	WAIT_PHASE,
	OTHER_PHASE,
	build_phases,
}

export type { PhaseInput, PhaseName, PhaseTotal }
export { time_phases }
