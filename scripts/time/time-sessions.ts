import type { SessionSpans } from './time-duplicate'
import { time_markers } from './time-markers'
import { time_overlap } from './time-overlap'
import type { Span } from './time-spans'

// Which of the sessions attributed to an issue actually ran it (joshuafolkken/kit#1428).
//
// Attribution is by branch and nothing else — `cost-attribute.ts`'s fill-forward walk — and a branch
// belongs to the **checkout**, not to a session. So every session that wrote a line while the issue's
// branch was checked out is attributed to that issue, whatever it was doing. Two sessions open in one
// work tree is ordinary rather than exotic: a run in one, an epic being planned or measured in the
// other.
//
// **The cost is not a rounding error.** Run #1412 read as 145 round trips, 208 tool calls and 31.1
// minutes of model wait against a hand count of 56, 77 and 7.9 — because a second session, busy with
// `josh epic` for 45 minutes across the same window, was counted into every one of them. `diag` ranks
// what to cut by those figures, so the contaminated reading put `wrapup 8.4 min` first where the hand
// reading of the same region was 37 seconds.
//
// **The discriminator already exists, one dimension over.** `time-markers.ts` names a `workflow`
// marker — loading the `workflow-commands` skill, or writing the `in-progress` label — precisely
// because "a run is not a session", and `time-phases.ts` uses it to say where a run *starts* inside a
// session. The same mark says *whose* run it is: a session that never opened a workflow on this issue
// did not run it. Recognizing the boundary a second way here would be the clone `CLAUDE.md` prohibits,
// in the one place a drift would make the `pre-run` row and this separation disagree about which
// session the run began in.
//
// **Nothing is excluded unless something is kept.** A run whose marker fell to an adjacent issue —
// the keyword typed while the previous branch was still checked out — leaves no session marked, and
// dropping every one of them would report the run as unmeasured rather than as inflated. That state
// is reported in words instead: `is_separated` is false, the spans come back whole, and `time-run.ts`
// prints that the run could not be separated. **`0.0 min` is the one answer it must never give**,
// because a reader cannot tell a run nobody else shared from a run nobody could separate.
//
// **A delegated unit follows the session that delegated it.** The map this reads is keyed by owning
// session, so a unit is never weighed on its own: its parent holds the marker, and an `epicrun` child
// implemented entirely inside a unit is kept with it.
//
// **The marker names an issue and sits in one half, and reading only its presence discarded both**
// (joshuafolkken/kit#1648). `time_markers.bash_issue` captures the number the `in-progress` call
// declared — that capture is why `label_issue` exists — and the two things thrown away produced two
// symptoms of one judgement. A session whose only declaring marker names a *different* run was kept
// as this one's: run #1630 kept a session that had opened #1481 four hours earlier, and its window
// began at 01:12 for a run that started at 05:21. And a session whose declaring marker sits in a
// **delegated** unit was kept **whole**, so the parent's coordination minutes — dispatching the
// previous child, reading the backlog — were counted as the child's run: #1654, #1609 and #1607 all
// recorded the identical `started_at` of their parent's first span.
//
// **So a marker that names this issue decides, and the presence test is what is left for the runs
// no marker names.** The skill-load marker carries no number, so a run that never wrote the label is
// still separated exactly as it was — the fallback is the old rule untouched, not a degraded one.
// **Why #1633 looked correct while #1630 did not** is the same defect twice: both were units of one
// parent, and #1633's marker happened to fall four minutes after the session's first attributed span
// while #1630's fell forty-one minutes after it, behind a sibling child that had already run.

const NO_DURATION = 0
const NO_SESSIONS = 0
// "No marker named this issue here", which is never a real instant: the epoch is not a time any
// transcript records, so a floor of zero keeps every span exactly as no floor would — and a ceiling
// of infinity is the same answer read forwards.
const NO_START = 0
const NO_END = Infinity
// Below this there is nothing to separate: one session is the run's whether or not it left a marker.
const AMBIGUOUS_MINIMUM = 2

// Minutes this run's figures do not hold, named by the session they came out of so a reader can open
// the transcript and check. **The shape is neutral about why they were dropped**, because the two
// reasons print as different sentences and a name that asserted one of them — `ExcludedSession`, as
// this was called — made the report say the wrong one of a session it had kept
// (joshuafolkken/kit#1673).
interface SessionMinutes {
	session_id: string
	duration_ms: number
}

interface SessionSplit {
	kept: Map<string, SessionSpans>
	// Sessions dropped whole: attributed to the issue, and no marker says they ran it.
	excluded: Array<SessionMinutes>
	// What narrowing a **kept** session dropped — the coordination minutes a parent spent around the
	// delegated unit that is this run. Carried apart from `excluded` because the session is in `kept`:
	// reporting it as one left out names the run's own transcript as a stranger's.
	narrowed: Array<SessionMinutes>
	// Whether a workflow marker named at least one session as this run's. **False is not "nothing was
	// excluded"** — it is "nothing could be", and the two print differently.
	is_separated: boolean
	// Whether any attributed session carries a workflow marker that names a *different* run. Only read
	// where `is_separated` is false, and there it is the difference between "no session carries a
	// marker" and "every marker here belongs to somebody else" — two states one sentence used to claim
	// to be the first of (joshuafolkken/kit#1673).
	has_other_run_markers: boolean
	// How many sessions were attributed before the split, which is what says whether a run no marker
	// named had anything to be separated from in the first place.
	attributed_count: number
}

function has_workflow_marker(spans: ReadonlyMap<string, Span>): boolean {
	for (const [, span] of spans) {
		if (span.marker === time_markers.WORKFLOW_MARKER) return true
	}

	return false
}

// **Both halves are read.** A session's own transcript holds the marker in the ordinary shape, and a
// unit's holds it where the unit was handed a whole child to run.
function is_run_session(session: SessionSpans): boolean {
	return has_workflow_marker(session.own) || has_workflow_marker(session.delegated)
}

function span_start(span: Span): number {
	return span.ended_ms - span.duration_ms
}

// **`NO_ISSUE` is not a declaration**: the skill-load marker says a run opened without saying whose,
// so it belongs to the presence test above and to nothing here.
function is_declaring(span: Span): boolean {
	return span.marker === time_markers.WORKFLOW_MARKER && span.issue !== time_markers.NO_ISSUE
}

// Every marker in this half that names an issue, as the issue it named and the instant it opened.
// One walk answers both questions asked of it — which issues a half declares, and when — so the two
// cannot drift apart.
function declarations(spans: ReadonlyMap<string, Span>): Array<[number, number]> {
	const found: Array<[number, number]> = []

	for (const [, span] of spans) {
		if (is_declaring(span)) found.push([span.issue, span_start(span)])
	}

	return found
}

function issues_in(declared: ReadonlyArray<[number, number]>): Set<number> {
	return new Set(declared.map(([issue_number]) => issue_number))
}

function starts_naming(
	declared: ReadonlyArray<[number, number]>,
	issue_number: number,
): Array<number> {
	return declared.filter(([named]) => named === issue_number).map(([, started]) => started)
}

function starts_naming_others(
	declared: ReadonlyArray<[number, number]>,
	issue_number: number,
): Array<number> {
	return declared.filter(([named]) => named !== issue_number).map(([, started]) => started)
}

function earliest(starts: ReadonlyArray<number>): number {
	return starts.length === NO_SESSIONS ? NO_START : Math.min(...starts)
}

function earliest_after(starts: ReadonlyArray<number>, after_ms: number): number {
	const later = starts.filter((one) => one > after_ms)

	return later.length === NO_SESSIONS ? NO_END : Math.min(...later)
}

// Where a delegated run began and where the next child's declaration ends it. **The parent's units
// are pooled under one key**, so a session that ran several children holds every one of their
// transcripts in this half — and a research unit inside a sibling declares no issue at all, so
// identity cannot tell the two apart. Position can, and the marker was put there to carry it:
// `time-markers.ts` calls it "the run starts here". **A floor without a ceiling only removes the
// siblings that ran first**, which left the first child of a parent absorbing every later one (a
// review finding on joshuafolkken/kit#1648) — so the same evidence is read forwards as well.
// **The ceiling is read from both halves, the floor from the unit's.** A parent can dispatch this
// child and then take the next issue up in-session, writing that declaration in its own file — and a
// ceiling that looked only at the units would never close, so the research units of that next run,
// which declare nothing, were counted as this child's.
function run_window(session: SessionSpans, issue_number: number): [number, number] {
	const delegated = declarations(session.delegated)
	const start_ms = earliest(starts_naming(delegated, issue_number))
	const others = [
		...starts_naming_others(delegated, issue_number),
		...starts_naming_others(declarations(session.own), issue_number),
	]

	return [start_ms, earliest_after(others, start_ms)]
}

function within_run(spans: ReadonlyMap<string, Span>, one: Marked): Map<string, Span> {
	const kept = new Map<string, Span>()

	for (const [key, span] of spans) {
		if (span_start(span) >= one.run_start_ms && span_start(span) < one.run_end_ms) {
			kept.set(key, span)
		}
	}

	return kept
}

function spans_of(spans: ReadonlyMap<string, Span>): Array<Span> {
	const drained: Array<Span> = []

	for (const [, span] of spans) drained.push(span)

	return drained
}

// What the exclusion cost, in the wall clock the note beside it claims to be naming.
//
// **The two halves are resolved against each other rather than summed raw.** A session that delegated
// holds one `Agent` span across the whole time the unit runs and the unit's transcript records the
// same minutes as work, so the raw sum reports an excluded session at close to twice its real wall
// clock — beside a kept run whose minutes went through exactly that subtraction. The arithmetic is
// `time-overlap.ts`'s, the same call `time-corpus.ts` makes for the sessions that stay, so the note
// and the report cannot mean two different things by a minute.
function session_ms(session: SessionSpans): number {
	const resolved = time_overlap.resolve_delegated(
		spans_of(session.own),
		spans_of(session.delegated),
	)

	return resolved.reduce((sum, span) => sum + span.duration_ms, NO_DURATION)
}

// One session with the answer already computed, so `is_run_session` is asked once per session rather
// than once per filter.
interface Marked {
	session_id: string
	session: SessionSpans
	is_own: boolean
	// Whether a workflow marker in this session names the issue being reported on. This is the
	// evidence the presence test above cannot give: it says *whose* run, not merely that one opened.
	names_issue: boolean
	// Whether it declares issues and none of them is this one. **This is the only thing that overrides
	// the presence test**, because it is evidence about a different run — and a session that declares
	// nothing keeps the older rule, which every transcript recorded before the declaration existed
	// still needs.
	names_only_others: boolean
	// ...and whether only a delegated unit named it. Then the unit is the run and the session around
	// it is the parent that dispatched it, whose own spans are coordination rather than this work.
	is_delegated_run: boolean
	// The window that unit declared, which its spans are taken from.
	run_start_ms: number
	run_end_ms: number
}

function mark_one(session_id: string, session: SessionSpans, issue_number: number): Marked {
	const own = issues_in(declarations(session.own))
	const is_named_by_own = own.has(issue_number)
	const [run_start_ms, run_end_ms] = run_window(session, issue_number)
	const is_named = is_named_by_own || run_start_ms !== NO_START

	return {
		session_id,
		session,
		is_own: is_run_session(session),
		names_issue: is_named,
		names_only_others: !is_named && own.size + issues_in(declarations(session.delegated)).size > 0,
		is_delegated_run: is_named && !is_named_by_own,
		run_start_ms,
		run_end_ms,
	}
}

function mark(by_session: ReadonlyMap<string, SessionSpans>, issue_number: number): Array<Marked> {
	const marked: Array<Marked> = []

	for (const [session_id, session] of by_session) {
		marked.push(mark_one(session_id, session, issue_number))
	}

	return marked
}

// What of a kept session is this run's. **The identity everywhere except the delegated case**, which
// is the whole of the narrowing: dropping the parent's own spans is what stops a child inheriting the
// minutes its parent spent before the child existed.
function narrow(one: Marked): SessionSpans {
	if (!one.is_delegated_run) return one.session

	return { own: new Map(), delegated: within_run(one.session.delegated, one) }
}

// **A session is this run's unless it declared a different one.** Naming the issue keeps it; naming
// only other issues excludes it however plainly it opened a workflow; and naming nothing falls back
// to the presence test. Deciding it once per corpus instead — "some session named it, so only named
// sessions count" — excluded the un-named half of a run that spanned two sessions, of which only the
// first had written the label (a review finding on joshuafolkken/kit#1648).
function is_this_run(one: Marked): boolean {
	if (one.names_issue) return true

	return !one.names_only_others && one.is_own
}

// Longest first, then by session id. Ordered from the spans rather than left as the order the
// transcript directory happened to list the files in, for the reason `time-overlap.ts` orders its
// delegated spans: an answer that depends on directory order is one that changes with a file's mtime.
function compare_minutes(left: SessionMinutes, right: SessionMinutes): number {
	if (left.duration_ms !== right.duration_ms) return right.duration_ms - left.duration_ms

	return left.session_id < right.session_id ? -1 : 1
}

// What narrowing a kept session dropped. **Reported beside the sessions left out whole, so the note
// and the arithmetic still agree**: minutes in neither `kept` nor `excluded` are minutes the report
// cannot account for, and the parent of a delegated run loses real ones here (a review finding on
// joshuafolkken/kit#1648). **Beside, and not among**: the session it names is one this run kept.
function narrowed_loss(one: Marked): Array<SessionMinutes> {
	if (!one.is_delegated_run) return []

	const duration_ms = session_ms(one.session) - session_ms(narrow(one))

	return duration_ms > NO_DURATION ? [{ session_id: one.session_id, duration_ms }] : []
}

function to_excluded(marked: ReadonlyArray<Marked>): Array<SessionMinutes> {
	return marked
		.filter((one) => !is_this_run(one))
		.map((one) => ({ session_id: one.session_id, duration_ms: session_ms(one.session) }))
		.toSorted(compare_minutes)
}

function to_narrowed(marked: ReadonlyArray<Marked>): Array<SessionMinutes> {
	return marked
		.filter((one) => is_this_run(one))
		.flatMap((one) => narrowed_loss(one))
		.toSorted(compare_minutes)
}

// Whether any attributed session opened a workflow on some *other* issue. Read only where nothing
// was kept, and there it is the whole difference between the two sentences that state can print.
function has_other_run_markers(marked: ReadonlyArray<Marked>): boolean {
	return marked.some((one) => one.names_only_others)
}

function to_kept(marked: ReadonlyArray<Marked>): Map<string, SessionSpans> {
	return new Map(
		marked.filter((one) => is_this_run(one)).map((one) => [one.session_id, narrow(one)]),
	)
}

function not_separated(
	by_session: ReadonlyMap<string, SessionSpans>,
	marked: ReadonlyArray<Marked>,
): SessionSplit {
	return {
		kept: new Map(by_session),
		excluded: [],
		narrowed: [],
		is_separated: false,
		has_other_run_markers: has_other_run_markers(marked),
		attributed_count: marked.length,
	}
}

// The run's own sessions, and what leaving the rest out cost. **The identity for a run measured in one
// session**, which is the overwhelming majority: one session marked is one session kept, and one
// session unmarked is `not_separated` over a corpus with nothing to separate — either way every span
// comes back.
function separate(
	by_session: ReadonlyMap<string, SessionSpans>,
	issue_number: number,
): SessionSplit {
	const marked = mark(by_session, issue_number)
	const kept = to_kept(marked)

	if (kept.size === NO_SESSIONS) return not_separated(by_session, marked)

	return {
		kept,
		excluded: to_excluded(marked),
		narrowed: to_narrowed(marked),
		is_separated: true,
		has_other_run_markers: has_other_run_markers(marked),
		attributed_count: marked.length,
	}
}

const time_sessions = { AMBIGUOUS_MINIMUM, separate }

export type { SessionMinutes, SessionSplit }
export { time_sessions }
