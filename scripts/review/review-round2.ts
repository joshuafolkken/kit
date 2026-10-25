import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { path_decision } from '#scripts/josh/path-decision'
import { json_value } from '#scripts/lib/json-value'
import { release_approval_prune } from '#scripts/release/release-approval-prune'
import { z } from 'zod'
import { review_level } from './review-level'

// Whether the second review round runs at all.
//
// **Narrowing round 2 does not show in the wall clock** (`prompts/review.md` → "The narrowing is real
// in scope and does not show in the wall clock"), so this asks whether it is due at all.
//
// **The two arms are the two states in which round 2's reason does not arise.** Round 2 exists
// because round 1's *fix code* is unreviewed, and that is structural. Arm A applies where there is no fix code — the findings closed without an edit — so
// the premise is absent rather than overridden. Arm B applies where the fix leaves what executes
// unchanged: `review-level.ts`'s inert set, documentation under `docs/` and the root `README.md`,
// `prompts/`, `josh metrics` approvals, and source files whose only change is in comments
// (`review-code-tree.ts`).
//
// **Arm B is wider than the review level's inert set, on purpose** (joshuafolkken/kit#3787). Round 1
// still reviews a documentation or prompt change in full, and the fix to its findings is still made;
// what goes unread is only that fix. `.claude/**`, `CLAUDE.md`, tests and configuration stay outside:
// a test fix can weaken the verification it belongs to, and nothing reads that but the review.

type RoundTwoVerdict = 'required' | 'skip'

const REQUIRED_VERDICT: RoundTwoVerdict = 'required'
const SKIPPED_VERDICT: RoundTwoVerdict = 'skip'
const VERDICTS = [REQUIRED_VERDICT, SKIPPED_VERDICT] as const

// One stable code per branch of `decide`, so a decision can be counted by why it fell where it did —
// the reason sentences carry paths and timestamps and cannot be (joshuafolkken/kit#4064).
const CODE = {
	EMPTY: 'empty',
	INERT: 'inert',
	OPEN_FINDING: 'open-finding',
	NO_SNAPSHOT: 'no-snapshot',
	BASE_MOVED: 'base-moved',
	LIVE: 'live',
} as const

type RoundTwoCode = (typeof CODE)[keyof typeof CODE]

// The key `josh review:round2 --json` prints its verdict under, read back by `josh ship`.
const JSON_KEY = 'round2'
const json_schema = z.object({
	[JSON_KEY]: z.enum(VERDICTS),
	code: z.enum(Object.values(CODE)),
	reason: z.string(),
})

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
	'every path round 1 fixed leaves what executes unchanged — inert, documentation, a prompt, a metrics approval, or a comment-only edit'
const README_PATH = 'README.md'
const DOCUMENTATION_PREFIX = 'docs/'
const MARKDOWN_EXTENSION = '.md'
const PROMPTS_PREFIX = 'prompts/'
const BASE_MOVED_REASON =
	"the change base moved since round 1 was recorded and round 1's tree could not be carried onto the new one — no recorded round-1 blobs, or the carry conflicts — so the fix delta cannot be named and the round runs"

interface RoundTwoInput {
	// **The commit the tree above is a diff against**. This decision reads the
	// same digest comparison the brief's round-2 target does, so it inherits the same failure: taken
	// against two different bases, the two maps do not cover the same set of paths, and an empty or
	// inert-looking delta is then no evidence at all about what round 1 fixed. Here that evidence buys
	// a `skip`, which is worse than a mistargeted read — nothing gets read at all.
	// `undefined` where it could not be resolved to a commit, which is refused exactly like a mismatch.
	base: string | undefined
	// Asserted by the caller from round 1's own output, because no command can read a review's
	// findings. It is a report of a fact already written down, not a judgement made under cost
	// pressure — and its absence is the safe answer, so a caller that forgets it pays a round.
	is_round_one_closed: boolean
	snapshot: FileMapStamp | undefined
	tree: Record<string, string>
	// The paths whose code round 1's fixes left as it was (`review_code_tree.comment_only`). Absent is
	// none, which is what a run without a code record pays.
	comment_only?: ReadonlyArray<string>
	// Asked only when the base moved: round 1's tree carried onto the current base, diffed against the
	// tree now (`review-round-one-blobs.ts`). `undefined`, or no reader at all, is the moved-base refusal.
	carried_delta?: (snapshot: FileMapStamp) => ReadonlyArray<string> | undefined
}

interface RoundTwoAnswer {
	verdict: RoundTwoVerdict
	code: RoundTwoCode
	reason: string
}

interface RoundTwoDecision extends RoundTwoAnswer {
	// The paths round 1's fixes changed. Returned even on `required` so the caller can name them, and
	// on a `skip` so the record the run leaves behind says what went unreviewed.
	delta: ReadonlyArray<string>
}

// **The snapshot's own timestamp travels with the answer**, the way `review-brief.ts` prints it
// beside a round-2 target. The record is written once per run and kept thereafter, so a bare
// `josh review:brief` cannot retake it after the fixes, which leaves "round 1 wrote no fix code" as
// the only reading of an empty delta. The timestamp stays in the reason because a record can still **outlive** its run —
// `josh followup` is what clears it — and a delta measured from an earlier run's record is wider
// rather than narrower, which a reader can only see from when that record was taken.
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

function is_documentation(relative: string): boolean {
	if (relative === README_PATH || relative.startsWith(PROMPTS_PREFIX)) return true

	return relative.startsWith(DOCUMENTATION_PREFIX) && relative.endsWith(MARKDOWN_EXTENSION)
}

// **A `josh metrics` approval is data, not code** (joshuafolkken/kit#4842): the ship's pre-detach
// re-record rewrites it after round 1, and the gate's own metrics step checks it — the same reason
// `review-reviewed-tree.ts` reads it as no move.
function is_unexecuted(relative: string, comment_only: ReadonlyArray<string>): boolean {
	if (
		review_level.is_inert(relative) ||
		is_documentation(relative) ||
		release_approval_prune.is_approval(relative)
	) {
		return true
	}

	return comment_only.includes(relative)
}

function verdict_for_delta(
	delta: ReadonlyArray<string>,
	taken_at: string,
	comment_only: ReadonlyArray<string> = [],
): RoundTwoAnswer {
	if (delta.length === 0) {
		return { verdict: SKIPPED_VERDICT, code: CODE.EMPTY, reason: empty_reason(taken_at) }
	}

	const deciding = delta.filter((relative) => !is_unexecuted(relative, comment_only))

	if (deciding.length === 0) {
		return { verdict: SKIPPED_VERDICT, code: CODE.INERT, reason: inert_reason(delta) }
	}

	return { verdict: REQUIRED_VERDICT, code: CODE.LIVE, reason: live_reason(deciding) }
}

function required(code: RoundTwoCode, reason: string): RoundTwoDecision {
	return { verdict: REQUIRED_VERDICT, code, reason, delta: [] }
}

// On a moved base the digest comparison is a set difference, not the fix delta, so the carried
// reading replaces it and every later rule is the same one an unmoved base gets.
function fix_delta(
	input: RoundTwoInput,
	snapshot: FileMapStamp,
): ReadonlyArray<string> | undefined {
	if (file_map_stamp.describes_base(snapshot, input.base)) {
		return file_map_stamp.changed_since(snapshot, input.tree)
	}

	return input.carried_delta?.(snapshot)
}

function decide(input: RoundTwoInput): RoundTwoDecision {
	if (!input.is_round_one_closed) return required(CODE.OPEN_FINDING, OPEN_FINDING_REASON)
	if (input.snapshot === undefined) return required(CODE.NO_SNAPSHOT, NO_SNAPSHOT_REASON)

	const delta = fix_delta(input, input.snapshot)

	if (delta === undefined) return required(CODE.BASE_MOVED, BASE_MOVED_REASON)

	return { ...verdict_for_delta(delta, input.snapshot.taken_at, input.comment_only), delta }
}

function to_json(answer: RoundTwoAnswer): string {
	return JSON.stringify({ [JSON_KEY]: answer.verdict, code: answer.code, reason: answer.reason })
}

// The answer `to_json` printed, or `undefined` for any other output — read by the one caller that
// records it, which must not guess a verdict from text it cannot parse.
function parse_json(text: string): RoundTwoAnswer | undefined {
	const parsed = json_schema.safeParse(json_value.parse_or_undefined(text.trim())).data

	return parsed === undefined
		? undefined
		: { verdict: parsed[JSON_KEY], code: parsed.code, reason: parsed.reason }
}

const review_round2 = {
	BASE_MOVED_REASON,
	CODE,
	decide,
	EMPTY_DELTA_REASON_PREFIX,
	empty_reason,
	INERT_DELTA_REASON_PREFIX,
	inert_reason,
	is_unexecuted,
	JSON_KEY,
	live_reason,
	NO_SNAPSHOT_REASON,
	OPEN_FINDING_REASON,
	parse_json,
	REQUIRED_VERDICT,
	SKIPPED_VERDICT,
	to_json,
	verdict_for_delta,
}

export type { RoundTwoAnswer, RoundTwoCode, RoundTwoVerdict }
export { review_round2 }
