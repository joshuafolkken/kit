import { time_overlap, type Interval } from './time-overlap'
import type { Span } from './time-spans'

// Which session a span that appears in more than one transcript is counted under
// (joshuafolkken/kit#1287).
//
// Resuming or forking a session copies the earlier lines into a new transcript file, so the same
// span is read from two of them — 152 such duplicated requests are measured in this repository's own
// corpus. `time-corpus.ts` folded those together by span key, but only *after* each session's own
// spans had been resolved against the units it delegated, and that is one step too late. The
// original session's `Agent` span is covered by its units and trimmed away; the copy sits in a
// resumed session with no `subagents/` of its own and survives whole. Trimming changed the original's
// key, so nothing collapses the two, and three minutes of wall clock are reported as six.
//
// **So a duplicate is assigned to one session before the subtraction rather than folded after it,
// and the session whose delegated units already account for those minutes takes it.** That is the
// assignment that is *correct* rather than merely deterministic: hand the copy to a session whose
// units do not cover it and its whole duration is counted beside the units that do, which is exactly
// the six minutes above. `list_sessions` is newest-first, so a naive first-wins does precisely that.
//
// **The rank is how much of the span the units cover, not whether the session delegated at all.**
// "It has units" is the same answer in the common shape and the wrong one as soon as both sessions
// delegated: a session resumed from another and then delegating a *different* unit over a later
// window has units that cover none of the copied span, and ranking it level with the original leaves
// the tie to be broken by the session id — which is to say, by chance, half the time reproducing the
// double count this exists to remove.
//
// Where coverage does not decide it — no unit covers the span on either side — the earliest-starting
// session takes it, since a resumed transcript begins by copying a session that started before it.
// The session id breaks whatever tie is left, so the answer never depends on directory order.
//
// **Assigning is not discarding.** Every span key still ends up counted exactly once; all that is
// decided here is which session's subtraction it is exposed to.

// What makes two readings of the same event the same span. Two transcripts holding a copied line
// produce identical instants, category and label, so the key folds them; a trim changes the instants
// and the key stops matching, which is why the assignment below runs before the trim rather than
// after it.
function span_key(span: Span): string {
	return [span.ended_ms, span.duration_ms, span.category, span.label].join('|')
}

// One session's transcripts, keyed by span key. **The two are kept apart because they overlap**: a
// session that delegates holds one `Agent` tool span for the whole time the unit runs, and the unit's
// transcript records those same minutes as the work it did.
interface SessionSpans {
	own: Map<string, Span>
	delegated: Map<string, Span>
}

// One session's standing when two of them hold the same span.
interface Claim {
	session_id: string
	// The intervals the session's delegated units occupy — what "already accounts for those minutes"
	// is measured against, per span rather than per session.
	covered: ReadonlyArray<Interval>
	started_ms: number
}

// The instant a session's work begins, its units' included. **Reading only the own spans would rank
// a session with none behind every other**, and that shape is real: a parent transcript pruned while
// its `subagents/` survived, and — far more ordinarily — a parent that wrote nothing on the branch
// the issue asked about. A session with nothing at all answers `Infinity` and loses every tie rather
// than winning one by accident.
function earliest_start(session: SessionSpans): number {
	let earliest = Infinity

	for (const spans of [session.own, session.delegated]) {
		for (const [, span] of spans) earliest = Math.min(earliest, span.ended_ms - span.duration_ms)
	}

	return earliest
}

function intervals_of(spans: ReadonlyMap<string, Span>): Array<Interval> {
	const intervals: Array<Interval> = []

	for (const [, span] of spans) intervals.push(time_overlap.to_interval(span))

	return intervals
}

function claim_of(session_id: string, session: SessionSpans): Claim {
	return {
		session_id,
		covered: intervals_of(session.delegated),
		started_ms: earliest_start(session),
	}
}

// How much of this span the session's delegated units already account for.
function covered_ms(claim: Claim, span: Span): number {
	const uncovered = time_overlap.uncovered_ms(time_overlap.to_interval(span), claim.covered)

	return span.duration_ms - uncovered
}

// Whether `candidate` should take a span `holder` currently holds, in the three-key order above.
function outranks(candidate: Claim, holder: Claim, span: Span): boolean {
	const mine = covered_ms(candidate, span)
	const theirs = covered_ms(holder, span)

	if (mine !== theirs) return mine > theirs
	if (candidate.started_ms !== holder.started_ms) return candidate.started_ms < holder.started_ms

	return candidate.session_id < holder.session_id
}

// The coverage comparison is reached only where a span really is held twice, which is what keeps it
// off the overwhelming majority of spans that appear in exactly one transcript.
function record_claim(owners: Map<string, Claim>, span: Span, claim: Claim): void {
	const key = span_key(span)
	const holder = owners.get(key)

	if (holder === undefined || outranks(claim, holder, span)) owners.set(key, claim)
}

function claim_each(
	owners: Map<string, Claim>,
	spans: ReadonlyMap<string, Span>,
	claim: Claim,
): void {
	for (const [, span] of spans) record_claim(owners, span, claim)
}

// **A session's own spans and its units' both stake a claim**, so a key is counted once whichever
// half of a session it sits in. The alternative — claiming only the own spans — would leave a unit
// transcript that was itself copied contributing twice.
function owners_of(by_session: ReadonlyMap<string, SessionSpans>): Map<string, Claim> {
	const owners = new Map<string, Claim>()

	for (const [session_id, session] of by_session) {
		const claim = claim_of(session_id, session)

		claim_each(owners, session.own, claim)
		claim_each(owners, session.delegated, claim)
	}

	return owners
}

function kept_by(
	spans: ReadonlyMap<string, Span>,
	session_id: string,
	owners: ReadonlyMap<string, Claim>,
): Map<string, Span> {
	const kept = new Map<string, Span>()

	for (const [key, span] of spans) {
		if (owners.get(key)?.session_id === session_id) kept.set(key, span)
	}

	return kept
}

// Every session's spans with each duplicate left in exactly one of them. The identity when no span
// key appears twice, which is what makes a run of one session — and a run that never resumed — report
// exactly as it did before.
function assign_duplicates(
	by_session: ReadonlyMap<string, SessionSpans>,
): Map<string, SessionSpans> {
	const owners = owners_of(by_session)
	const assigned = new Map<string, SessionSpans>()

	for (const [session_id, session] of by_session) {
		assigned.set(session_id, {
			own: kept_by(session.own, session_id, owners),
			delegated: kept_by(session.delegated, session_id, owners),
		})
	}

	return assigned
}

const time_duplicate = {
	span_key,
	assign_duplicates,
}

export type { SessionSpans }
export { time_duplicate }
