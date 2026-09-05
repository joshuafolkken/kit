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

const NO_DURATION = 0
const NO_SESSIONS = 0
// Below this there is nothing to separate: one session is the run's whether or not it left a marker.
const AMBIGUOUS_MINIMUM = 2

// One session left out of a run, named so a reader can open the transcript and check.
interface ExcludedSession {
	session_id: string
	duration_ms: number
}

interface SessionSplit {
	kept: Map<string, SessionSpans>
	excluded: Array<ExcludedSession>
	// Whether a workflow marker named at least one session as this run's. **False is not "nothing was
	// excluded"** — it is "nothing could be", and the two print differently.
	is_separated: boolean
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
}

function mark(by_session: ReadonlyMap<string, SessionSpans>): Array<Marked> {
	const marked: Array<Marked> = []

	for (const [session_id, session] of by_session) {
		marked.push({ session_id, session, is_own: is_run_session(session) })
	}

	return marked
}

// Longest first, then by session id. Ordered from the spans rather than left as the order the
// transcript directory happened to list the files in, for the reason `time-overlap.ts` orders its
// delegated spans: an answer that depends on directory order is one that changes with a file's mtime.
function compare_excluded(left: ExcludedSession, right: ExcludedSession): number {
	if (left.duration_ms !== right.duration_ms) return right.duration_ms - left.duration_ms

	return left.session_id < right.session_id ? -1 : 1
}

function to_excluded(marked: ReadonlyArray<Marked>): Array<ExcludedSession> {
	return marked
		.filter((one) => !one.is_own)
		.map((one) => ({ session_id: one.session_id, duration_ms: session_ms(one.session) }))
		.toSorted(compare_excluded)
}

function to_kept(marked: ReadonlyArray<Marked>): Map<string, SessionSpans> {
	return new Map(marked.filter((one) => one.is_own).map((one) => [one.session_id, one.session]))
}

function not_separated(
	by_session: ReadonlyMap<string, SessionSpans>,
	attributed_count: number,
): SessionSplit {
	return { kept: new Map(by_session), excluded: [], is_separated: false, attributed_count }
}

// The run's own sessions, and what leaving the rest out cost. **The identity for a run measured in one
// session**, which is the overwhelming majority: one session marked is one session kept, and one
// session unmarked is `not_separated` over a corpus with nothing to separate — either way every span
// comes back.
function separate(by_session: ReadonlyMap<string, SessionSpans>): SessionSplit {
	const marked = mark(by_session)
	const kept = to_kept(marked)

	if (kept.size === NO_SESSIONS) return not_separated(by_session, marked.length)

	return {
		kept,
		excluded: to_excluded(marked),
		is_separated: true,
		attributed_count: marked.length,
	}
}

const time_sessions = { AMBIGUOUS_MINIMUM, separate }

export type { ExcludedSession, SessionSplit }
export { time_sessions }
