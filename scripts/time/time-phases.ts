import type { CiFacts } from './time-ci'
import { time_markers } from './time-markers'
import { time_overlap } from './time-overlap'
import {
	CI_PHASE,
	COMMAND_PHASES,
	GATE_COMMAND,
	GATE_PHASE,
	IMPLEMENT_PHASE,
	MERGE_PHASE,
	OTHER_PHASE,
	PHASE_ORDER,
	PLAN_PHASE,
	POST_RUN_PHASE,
	PR_PHASE,
	PRE_RUN_PHASE,
	REVIEW_PHASE,
	REWORK_PHASE,
	SETUP_PHASE,
	SPAN_BACKED_PHASES,
	WAIT_OUTSIDE_PHASE,
	WAIT_PHASE,
	WRAPUP_PHASE,
	type PhaseName,
} from './time-phase-names'
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
// `review`, `pr` and `merge` untouched.
//
// **`wait` is then cut at the run's own edges, exactly as the remainder already was**
// (joshuafolkken/kit#1331). Measured on three merged `fullrun`s it was 29–49% of the run and the
// single largest phase in one of them, and that one row held two different things: time the run
// stalled on a person, which a proposal can cut, and time the session was idle before the keyword
// was typed or after the merge, which is not the run's at all. It is the distinction
// joshuafolkken/kit#1299 drew for `other`, never drawn here only because `wait` was pinned to the
// category total — so the largest row in the table was the one nothing could be proposed against.
//
// **The invariant that replaces that pin: `wait` + `wait-outside` equals the human-wait category
// exactly.** No other phase can take a human span and neither row can take anything else, so the
// *sum* is what the two halves of the report are now cross-checked against. The two are detected on
// one criterion — `has_transcript_data`, which is the one `wait` already had — so they are withheld
// together or printed together: a report printing one and withholding the other could not be
// cross-checked at all, which is the property this split preserves rather than spends.
//
// **`setup`, `wrapup`, `pre-run` and `post-run` are the remainder cut into the regions it was made
// of** (joshuafolkken/kit#1299). `other` prints with `is_detected: true`, so it ranked as a measured
// block nobody could propose a cut against — 19–63% of each of the four runs that filed the issue,
// larger in every one of them than the biggest named phase. Measured across six merged runs it is
// two stretches and almost nothing else: before the first edit, and after the pull request opened.
// So each becomes a window like `implement` and `rework`, decided from boundary markers in exactly
// the same way, and `other` is left as the genuine remainder rather than as the place four different
// answers were pooled.
//
// **`pre-run` and `post-run` are what a run *is not*, and they are the reason the other two are
// readable.** A run is not a session: spans are attributed to an issue by branch, filled forward
// before the branch exists and backward after the merge, so a session that ran a `diag` before the
// keyword was typed and filed the next issue after the merge contributes both to this run. One
// measured run charged 9.9 minutes of a following conversation to itself. Naming that separates
// "the run spent this" from "this was attributed to the run", which is the difference between a cut
// worth proposing and one that would change nothing.
//
// **They are two rows rather than one `outside`, because they rest on two different boundaries.** A
// `halfrun` has a workflow marker and no merge; a delegated unit whose parent loaded the skill has
// the merge and no marker. One row detected on either would print `0.0 min` as a measurement for
// whichever half it never checked — the confident zero `is_detected` exists to prevent, in the phase
// added to stop exactly that kind of claim.
//
// **The four take only what was already `other`, so no existing phase moves.** They are tested
// after the command phases and after the three windows, which is what makes this change a
// subdivision of one row rather than a reclassification. **The two boundaries they rest on are what
// `wait` is now cut at too** — a human span is charged to `wait-outside` rather than to `pre-run` or
// `post-run`, so those two keep reporting work and the waiting stays in a row of its own.

const NO_DURATION = 0

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
	// The CI half, whole: the category share, the per-commit windows, and whether either was read.
	// One record rather than a field per figure, because a caller that has some of them and not the
	// others is a caller that has misread what was measured (joshuafolkken/kit#1384).
	ci: CiFacts
}

// `undefined` means the marker never appeared, which is the phase's "not detected" answer. A
// sentinel instant would be indistinguishable from a real one at the epoch.
interface Windows {
	// Where the workflow itself opened — the `workflow-commands` skill call or the `in-progress`
	// label, whichever came first. `undefined` means the transcript carried neither, in which case
	// nothing can be said to have happened before the run and `pre-run` reports itself as
	// undetected rather than as empty. It is also the floor every other boundary search takes.
	workflow_start_ms: number | undefined
	plan_end_ms: number | undefined
	// The first instant the run had demonstrably moved past preparing, which is where `setup` closes.
	// The same instant `plan_end_of` is bounded by, held rather than recomputed so the two cannot
	// come to disagree about where preparation ended.
	work_start_ms: number | undefined
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
	// Where the pull request opened, which is where `wrapup` starts. It is `rework_end_ms` read a
	// second time, and the two differ in exactly the state that matters: no pull request leaves this
	// `undefined` — so `wrapup` is reported as never reached — while `rework_end_ms` falls back to the
	// end of what was measured, which is the `halfrun` case rework already handles.
	pr_open_ms: number | undefined
	// Where the merge command finished, which is where `post-run` opens. The **last** one rather
	// than the first: `followup` exits non-zero on an AI-review blocker and is re-run, and taking the
	// first would charge the fixes between the two attempts to what came after the run.
	merge_end_ms: number | undefined
}

interface Detection {
	windows: Windows
	totals: ReadonlyMap<PhaseName, number>
	ci: CiFacts
	// The CI the merge command sat waiting for, which `ci` gains and `merge` loses below.
	serial_ci_ms: number
	has_transcript_data: boolean
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

// When the earliest matching span opened, or `undefined` for no match at all — the shape every
// boundary below is. Written once because "find it, then read its start" is the same two lines at
// each of them, and a copy per boundary is where one of them comes to read `ended_ms` instead.
function first_start_of(
	spans: ReadonlyArray<Span>,
	is_match: (span: Span) => boolean,
): number | undefined {
	const found = first_by(spans, is_match)

	return found === undefined ? undefined : started_ms(found)
}

function is_gate(span: Span): boolean {
	return span.josh_command === GATE_COMMAND
}

function is_edit(span: Span): boolean {
	return span.marker === time_markers.EDIT_MARKER
}

function is_workflow(span: Span): boolean {
	return span.marker === time_markers.WORKFLOW_MARKER
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
//
// **And it has to open after the workflow did**, for the same reason every other boundary takes that
// floor: a plan-shaped comment written before the keyword was typed sets this ahead of the run, and
// because planning is tested before the regions, the whole pre-run stretch is then reported as this
// run's planning while `pre-run` prints a detected `0.0 min` beside it.
function plan_end_of(
	spans: ReadonlyArray<Span>,
	start_ms: number | undefined,
	floor_ms: number | undefined,
): number | undefined {
	const is_plan_marker = (span: Span): boolean =>
		span.marker === time_markers.PLAN_MARKER &&
		is_after(span, floor_ms) &&
		ends_before(span, start_ms)

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
	return first_start_of(spans, (span) => is_gate(span) && is_after(span, start_ms))
}

// **Rework closes where the pull request opens, not where the review starts.** Closing it at the
// review would send every fix the review itself demanded straight back into `other` — the same
// defect one stage further along, since a `fullrun` fixes what round one found and then re-reviews.
// `josh git` / `josh pr` is the first instant the run demonstrably stopped changing code, and it is
// a command name rather than a duration, so the boundary does not move when a run gets faster.
// `undefined` is a run that stopped before its pull request; rework falls back to the end of what
// was measured there, and `wrapup` reports that it was never reached.
function pr_open_of(spans: ReadonlyArray<Span>, start_ms: number | undefined): number | undefined {
	return first_start_of(
		spans,
		(span) => command_phase(span) === PR_PHASE && is_after(span, start_ms),
	)
}

// Where the run stopped being the run. The last merge command's *end* rather than a start, because
// the merge is work the run did and only what follows it is not.
//
// **It takes the same floor every other boundary does.** A session that merged the previous issue
// before this run opened has that `josh followup` in its transcript, and without the floor it closes
// this run before it starts — every unphased span then answers `post-run`, leaving `setup` and
// `wrapup` at `0.0 min` and still detected.
function merge_end_of(
	spans: ReadonlyArray<Span>,
	floor_ms: number | undefined,
): number | undefined {
	const ends = spans
		.filter((span) => command_phase(span) === MERGE_PHASE && is_after(span, floor_ms))
		.map((span) => span.ended_ms)

	return ends.length === 0 ? undefined : Math.max(...ends)
}

// The first instant the run had demonstrably moved past planning. **The first edit is not enough on
// its own**: a run whose file changes went through Bash — `sed -i` and the like — records no edit
// marker at all, and with no bound the guard above accepts any plan-shaped call anywhere, so that
// run's *completion* comment closed a planning phase covering nearly the whole of it. The first
// command phase is the second bound, and either one alone answers the question the guard asks.
function work_start_of(
	spans: ReadonlyArray<Span>,
	edit: Span | undefined,
	floor_ms: number | undefined,
): number | undefined {
	const command = first_by(
		spans,
		(span) => command_phase(span) !== undefined && is_after(span, floor_ms),
	)
	const marks = [edit, command]
		.filter((span): span is Span => span !== undefined)
		.map((span) => started_ms(span))

	return marks.length === 0 ? undefined : Math.min(...marks)
}

// **Every boundary below is searched for at or after the workflow opened, and that floor is not
// cosmetic.** The spans attributed to an issue reach back before the keyword was typed, so an edit
// made by whatever the session was doing first would open `implement` ahead of the run — swallowing
// the whole preceding stretch, reporting `setup` as an empty window that was detected, and leaving
// `pre-run` at `0.0 min` beside it. The gate and the pull request take the same floor for the same
// reason, through `?? workflow_start_ms` where their own opening boundary was never found, and so do
// the plan comment and the merge — **all five, because a floor applied to some of them is the same
// defect surviving in whichever one was left out**. With no workflow marker at all the floor is
// `undefined` and every search is exactly what it was.
// Where a window closes when the boundary that should have closed it was never found: the end of
// what was measured. Both windows that have such a fallback take it from here, so "a `halfrun` runs
// its window to the end" is one rule rather than two that could come to disagree.
function window_end_of(start_ms: number | undefined, spans: ReadonlyArray<Span>): number {
	return start_ms ?? run_end_ms(spans)
}

function build_windows(spans: ReadonlyArray<Span>): Windows {
	const workflow_start_ms = first_start_of(spans, is_workflow)
	const edit = first_by(spans, (span) => is_edit(span) && is_after(span, workflow_start_ms))
	const implement_start_ms = edit === undefined ? undefined : started_ms(edit)
	const rework_start_ms = first_gate_of(spans, implement_start_ms ?? workflow_start_ms)
	const work_start_ms = work_start_of(spans, edit, workflow_start_ms)
	const pr_open_ms = pr_open_of(spans, rework_start_ms ?? workflow_start_ms)

	return {
		workflow_start_ms,
		plan_end_ms: plan_end_of(spans, work_start_ms, workflow_start_ms),
		work_start_ms,
		implement_start_ms,
		implement_end_ms: window_end_of(rework_start_ms, spans),
		rework_start_ms,
		rework_end_ms: window_end_of(pr_open_ms, spans),
		pr_open_ms,
		merge_end_ms: merge_end_of(spans, workflow_start_ms),
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

// The two comparisons every region below is: a span's start against one boundary that may not have
// been found. Written once because four copies of "is it defined, and is the start on this side of
// it" is where one of them comes to read `ended_ms`, or to answer `true` for a boundary that was
// never found — which is the region silently swallowing the whole run.
//
// **An undefined boundary answers `false`, never "everything".** A run whose transcript carried no
// workflow marker has nothing before it rather than everything before it.
function starts_before(span: Span, boundary_ms: number | undefined): boolean {
	return boundary_ms !== undefined && started_ms(span) < boundary_ms
}

function starts_at_or_after(span: Span, boundary_ms: number | undefined): boolean {
	return boundary_ms !== undefined && started_ms(span) >= boundary_ms
}

// Whether the span sits outside the run at all, and on which side. `undefined` is "inside", which is
// what the two regions below presuppose — so this is asked first.
//
// **`post-run` opens at the merge *command's* end, not at the merge instant GitHub records.** The
// merge happens inside a `josh followup` span that is already counted, so the command's end is the
// last thing the transcript can be read for — and `josh ms` and the report the run writes afterwards
// are charged here with whatever followed them. That is the deliberate half of the trade, measured
// at under a minute against the 9.9 minutes of a *following* conversation that `wrapup` would
// otherwise have reported as this run's own work.
function outside_phase(span: Span, windows: Windows): PhaseName | undefined {
	if (starts_before(span, windows.workflow_start_ms)) return PRE_RUN_PHASE

	return starts_at_or_after(span, windows.merge_end_ms) ? POST_RUN_PHASE : undefined
}

// The two regions inside the run, and then the remainder that is genuinely one.
//
// `setup` is everything before the run had demonstrably started working — reading the issue,
// normalizing its title, `git switch main && git pull`, the dependency-update question, and the
// turns spent settling the approach. `wrapup` is everything after the pull request opened: the
// second review round's fixes, the follow-up filing and its bundle, and the completion summary.
//
// **`wrapup` runs to the end of what was measured when the pull request never merged**, exactly as
// `rework` runs to it when none was opened: with no merge command there is no boundary to close it
// at, so a run reported here as still open has whatever followed it charged to `wrapup`. `post-run`
// says so in its own row by printing `not detected`.
function inside_phase(span: Span, windows: Windows): PhaseName {
	if (starts_before(span, windows.work_start_ms)) return SETUP_PHASE

	return starts_at_or_after(span, windows.pr_open_ms) ? WRAPUP_PHASE : OTHER_PHASE
}

function unphased_phase(span: Span, windows: Windows): PhaseName {
	return outside_phase(span, windows) ?? inside_phase(span, windows)
}

// The order the three windows are tested in does not matter. Implementation and rework meet at the
// first gate and never overlap, and `plan_end_of` accepts no marker that closes after implementation
// opens — so the windows are disjoint by construction rather than by assumption. What follows them
// is a subdivision of the remainder and never takes a span from one of them.
function window_phase(span: Span, windows: Windows): PhaseName {
	const { implement_start_ms, implement_end_ms, rework_start_ms, rework_end_ms } = windows

	if (is_within(span, implement_start_ms, implement_end_ms)) return IMPLEMENT_PHASE
	if (is_within(span, rework_start_ms, rework_end_ms)) return REWORK_PHASE
	if (is_planning(span, windows)) return PLAN_PHASE

	return unphased_phase(span, windows)
}

// Which of the two wait rows a human span belongs to, read off the same `outside_phase` the regions
// use — one rule for "which side of the run is this on", never two that could come to disagree.
//
// **A wait is placed by where it started, exactly as every other span is** (joshuafolkken/kit#1331).
// A session idle across the keyword — a human span opening before the workflow marker and closing at
// the prompt that typed it — is charged wholly to `wait-outside`. Splitting the interval at the
// boundary is the one thing that would stop every span landing in exactly one phase, which is what
// makes the phases reconstruct the elapsed time; and the reading is the true one for that case
// anyway, since nobody was waiting on a run that had not started.
function wait_phase(span: Span, windows: Windows): PhaseName {
	return outside_phase(span, windows) === undefined ? WAIT_PHASE : WAIT_OUTSIDE_PHASE
}

// **Waiting is decided before anything else, because it is not work.** A human span closes at a
// typed prompt and so carries no command, which means the tests below would have sent every one of
// them to a window or to `other` — and a window that collects them stops answering how long its
// stage took.
function span_phase(span: Span, windows: Windows): PhaseName {
	if (span.category === time_spans.HUMAN_CATEGORY) return wait_phase(span, windows)

	return command_phase(span) ?? window_phase(span, windows)
}

// Each span's phase, in the order they were handed over (joshuafolkken/kit#1311). The segment listing
// cuts the run wherever this answer changes, so it *reads* the classification rather than restating
// it — one rule for which phase a span belongs to, never two that could come to disagree about where
// implementation ended.
//
// **The windows are built from the whole array, not from the slice a caller happens to hold.** A
// boundary is the earliest span matching it, so classifying a subset would move every window.
function classify(spans: ReadonlyArray<Span>): Array<PhaseName> {
	const windows = build_windows(spans)

	return spans.map((span) => span_phase(span, windows))
}

function totals_of(spans: ReadonlyArray<Span>, windows: Windows): Map<PhaseName, number> {
	const totals = new Map<PhaseName, number>()

	for (const span of spans) {
		const phase = span_phase(span, windows)

		totals.set(phase, (totals.get(phase) ?? NO_DURATION) + span.duration_ms)
	}

	return totals
}

// Each of the four rests on a half being present rather than on a marker: `ci` on the GitHub half,
// the two wait rows and `other` on the transcript half — the same two flags the matching category
// rows are withheld on, so the two halves of the report cannot disagree about what was read.
// **`ci` needs both halves of its own reading** (joshuafolkken/kit#1384): the merge, and the check
// windows the serialized wait is measured from. A run whose check-runs could not be read still has a
// category share, but the phase would be a floor rather than a measurement — and printing it as
// `0.0 min` is exactly the false zero that had the wait attributed to `merge` in the first place.
function is_marker_detected(phase: PhaseName, found: Detection): boolean {
	if (phase === CI_PHASE) return found.ci.has_ci_data && found.ci.has_windows
	if (SPAN_BACKED_PHASES.has(phase)) return found.has_transcript_data

	return found.totals.has(phase)
}

// The one boundary each window phase is detected on, which is `undefined` exactly when this
// transcript could not be read for it. A table rather than a branch per phase: seven of them ask the
// identical question of a different field, and seven copies of it is where one comes to ask it of
// the wrong one.
//
// **`pre-run` and `post-run` have a row each because they have a boundary each.** Detecting one row
// on either of the two would print `0.0 min` as a measurement for whichever half was never checked —
// and a run has exactly one of them missing far more often than none: a `halfrun` never merges, and
// a delegated unit never loads the skill its parent did.
const WINDOW_BOUNDARIES = new Map<PhaseName, keyof Windows>([
	[PLAN_PHASE, 'plan_end_ms'],
	[SETUP_PHASE, 'work_start_ms'],
	[IMPLEMENT_PHASE, 'implement_start_ms'],
	[REWORK_PHASE, 'rework_start_ms'],
	[WRAPUP_PHASE, 'pr_open_ms'],
	[PRE_RUN_PHASE, 'workflow_start_ms'],
	[POST_RUN_PHASE, 'merge_end_ms'],
])

// `undefined` for a phase this table has nothing to say about, which is what hands it on to the
// marker-backed test rather than answering `false` for it.
function is_window_detected(phase: PhaseName, windows: Windows): boolean | undefined {
	const boundary = WINDOW_BOUNDARIES.get(phase)

	return boundary === undefined ? undefined : windows[boundary] !== undefined
}

function is_detected(phase: PhaseName, found: Detection): boolean {
	return is_window_detected(phase, found.windows) ?? is_marker_detected(phase, found)
}

// The CI a cycle spent with the run doing nothing else (joshuafolkken/kit#1384).
//
// **The merge command's span is left out of the covering set, and that is the whole of the change.**
// `followup --merge` waits for the checks *inside* a Bash span, so every serialized cycle is covered
// by one — which is why measuring the cycles against every span answered zero, and why the 109
// seconds of PR #1380's second cycle read as merge work. Every other span stays in: a cycle that ran
// beside the review, the round-2 fixes or a person's own wait cost the run nothing extra, and
// charging it to `ci` would count those minutes twice.
//
// **What `ci` gains, `merge` loses**, so the phases still reconstruct the elapsed time exactly. The
// part is covered by a merge span by construction, so it can never exceed that phase's own total.
function serial_ci_ms(spans: ReadonlyArray<Span>, windows: Windows, ci: CiFacts): number {
	if (!ci.has_windows) return NO_DURATION

	const all = spans.map((span) => time_overlap.to_interval(span))
	const rest = spans
		.filter((span) => span_phase(span, windows) !== MERGE_PHASE)
		.map((span) => time_overlap.to_interval(span))

	return time_overlap.covered_only_by_ms(ci.windows, all, rest)
}

// Neither `ci` nor `merge` is the span total it looks like. `ci` is the part of the open→merge window
// no span covers **plus** the cycles only the merge command sat on; `merge` is its own spans less that
// same quantity, so the pair moves without changing what the two of them add up to.
function duration_of(phase: PhaseName, found: Detection): number {
	const total = found.totals.get(phase) ?? NO_DURATION

	if (phase === CI_PHASE) return found.ci.ci_ms + found.serial_ci_ms
	if (phase === MERGE_PHASE) return total - found.serial_ci_ms

	return total
}

function build_phases(input: PhaseInput): Array<PhaseTotal> {
	const windows = build_windows(input.spans)
	const found: Detection = {
		windows,
		totals: totals_of(input.spans, windows),
		ci: input.ci,
		serial_ci_ms: serial_ci_ms(input.spans, windows, input.ci),
		has_transcript_data: time_spans.has_transcript_data(input.spans.length),
	}

	return PHASE_ORDER.map((phase) => ({
		phase,
		duration_ms: duration_of(phase, found),
		is_detected: is_detected(phase, found),
	}))
}

const time_phases = {
	PHASE_ORDER,
	PLAN_PHASE,
	SETUP_PHASE,
	IMPLEMENT_PHASE,
	GATE_PHASE,
	REWORK_PHASE,
	REVIEW_PHASE,
	PR_PHASE,
	WRAPUP_PHASE,
	CI_PHASE,
	MERGE_PHASE,
	WAIT_PHASE,
	WAIT_OUTSIDE_PHASE,
	PRE_RUN_PHASE,
	POST_RUN_PHASE,
	OTHER_PHASE,
	build_phases,
	classify,
}

export type { PhaseInput, PhaseTotal }
export { time_phases }

export { type PhaseName } from './time-phase-names'
