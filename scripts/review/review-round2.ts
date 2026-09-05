import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { path_decision } from '#scripts/josh/path-decision'
import { review_level } from './review-level'

// Whether the second review round runs at all (joshuafolkken/kit#1433).
//
// **Every previous measure narrowed round 2; this one asks whether it is due.** joshuafolkken/kit#1219
// redefined its question, joshuafolkken/kit#1241 carried that question into the forked agent, and
// `prompts/review.md` → "The narrowing is real in scope and does not show in the wall clock" recorded
// that neither moved the wall clock. Those records answer "narrow round 2"; none of them answers "do
// not run it", because none measured a run that skipped one.
//
// **The two arms are the two states in which joshuafolkken/kit#1222's reason does not arise.** That
// issue's conclusion is that round 2 exists because round 1's *fix code* is unreviewed, and that this
// is structural. Arm A applies where there is no fix code — the findings closed without an edit — so
// the premise is absent rather than overridden. Arm B applies where the fix code neither executes,
// nor instructs, nor ships, which is `review-level.ts`'s inert set: the same three ways a defect in
// this repository escapes, read here for the fix delta instead of the whole change.
//
// **The wider line the issue proposed — "the fix delta touches no runtime code path" — is not
// adopted**, and the evidence against it is already in this directory. `review-level.ts` records that
// joshuafolkken/kit#963 and #965 were documentation-only diffs in which a `medium` review found ten
// real defects each — dangling pointers and citations naming the wrong file, in artifacts distributed
// to every consumer — that no test covered. A prompt fix and a test fix are exactly where the review
// is the only detector, so exempting them would remove the round in the case it earns its keep.

type RoundTwoVerdict = 'required' | 'skip'

const REQUIRED_VERDICT: RoundTwoVerdict = 'required'
const SKIPPED_VERDICT: RoundTwoVerdict = 'skip'

// **The default is `required`, and every uncertainty resolves to it.** A command that answered `skip`
// on a missing record would be the cheapest possible run and the most dangerous — the direction
// `review-brief.ts` already takes when it widens a round-2 target it cannot name.
const OPEN_FINDING_REASON =
	'the caller did not assert that every round-1 High/Medium finding closed, so the pass that verifies them is due'
const NO_SNAPSHOT_REASON =
	'no round-1 snapshot was recorded, so the fix delta cannot be named — the round runs rather than assuming it is empty'
const EMPTY_DELTA_REASON_PREFIX =
	'the fix delta is empty: round 1 wrote no fix code, so there is no unreviewed fix for a verification pass to read'
const INERT_DELTA_REASON_PREFIX =
	'every path round 1 fixed is inert — it neither executes, nor instructs, nor ships'

interface RoundTwoInput {
	// Asserted by the caller from round 1's own output, because no command can read a review's
	// findings. It is a report of a fact already written down, not a judgement made under cost
	// pressure — and its absence is the safe answer, so a caller that forgets it pays a round.
	is_round_one_closed: boolean
	snapshot: FileMapStamp | undefined
	tree: Record<string, string>
}

interface RoundTwoDecision {
	verdict: RoundTwoVerdict
	reason: string
	// The paths round 1's fixes changed. Returned even on `required` so the caller can name them, and
	// on a `skip` so the record the run leaves behind says what went unreviewed.
	delta: ReadonlyArray<string>
}

// **The snapshot's own timestamp travels with the answer**, the way `review-brief.ts` prints it
// beside a round-2 target. An empty delta has two readings — round 1 wrote no fix code, or the
// record was retaken after the fixes by a bare `josh review:brief` — and the digests cannot tell
// them apart. Printing when round 1 was recorded is what lets a person reading the Issue comment
// see a timestamp that postdates the fixes, which is the only way that second reading shows.
function empty_reason(taken_at: string): string {
	return `${EMPTY_DELTA_REASON_PREFIX} (round 1 was recorded at ${taken_at})`
}

// **Every path, not `format_path_list`'s first five.** This sentence is what the run quotes into the
// `## Round 2 skipped` comment, and the whole purpose of that record is to attribute a defect found
// later to the delta that went unreviewed — which a list ending in `+3 more` cannot do. The
// truncation exists to keep a large diff's reason readable; arm B's delta is inert-only, so there is
// no large diff here to keep readable.
function inert_reason(delta: ReadonlyArray<string>): string {
	return `${INERT_DELTA_REASON_PREFIX}: ${delta.join(', ')}`
}

// The `required` side keeps the truncation: nothing is recorded from it, and a reason naming every
// path of a hundred-file change would bury the answer it exists to explain.
function live_reason(deciding: ReadonlyArray<string>): string {
	return `round 1's fixes touched paths that execute, instruct or ship: ${path_decision.format_path_list(deciding)}`
}

function verdict_for_delta(
	delta: ReadonlyArray<string>,
	taken_at: string,
): { verdict: RoundTwoVerdict; reason: string } {
	if (delta.length === 0) return { verdict: SKIPPED_VERDICT, reason: empty_reason(taken_at) }

	const deciding = delta.filter((relative) => !review_level.is_inert(relative))

	if (deciding.length === 0) return { verdict: SKIPPED_VERDICT, reason: inert_reason(delta) }

	return { verdict: REQUIRED_VERDICT, reason: live_reason(deciding) }
}

function decide(input: RoundTwoInput): RoundTwoDecision {
	if (!input.is_round_one_closed) {
		return { verdict: REQUIRED_VERDICT, reason: OPEN_FINDING_REASON, delta: [] }
	}

	if (input.snapshot === undefined) {
		return { verdict: REQUIRED_VERDICT, reason: NO_SNAPSHOT_REASON, delta: [] }
	}

	const delta = file_map_stamp.changed_since(input.snapshot, input.tree)

	return { ...verdict_for_delta(delta, input.snapshot.taken_at), delta }
}

const review_round2 = {
	decide,
	EMPTY_DELTA_REASON_PREFIX,
	empty_reason,
	INERT_DELTA_REASON_PREFIX,
	inert_reason,
	live_reason,
	NO_SNAPSHOT_REASON,
	OPEN_FINDING_REASON,
	REQUIRED_VERDICT,
	SKIPPED_VERDICT,
	verdict_for_delta,
}

export type { RoundTwoDecision, RoundTwoInput, RoundTwoVerdict }
export { review_round2 }
