import { review_round_reuse, type ReuseAnswer } from '#scripts/review/review-round-reuse'

// Why the ship's review stage ran or was skipped, written on its event line so `josh lane:breakdown`
// shows it beside the stage's minutes (joshuafolkken/kit#5296). The stage runs only under `--review`;
// within it, a recorded round 1 attested on this branch whose tree held, or moved only where round 2
// reads, is reused (`review-round-reuse.ts`) — anything else is reviewed again, for the cause the reuse
// answer names.

const HELD_REASON = 'reused: round 1 attested on this branch, its tree held'
const DELTA_REASON = "reused: round 1 attested on this branch, what moved since is round 2's delta"
const RAN_PREFIX = 'ran: --review with no reusable round 1 — '
const UNNAMED_CAUSE = 'the recorded round does not cover this tree'

function reused(answer: ReuseAnswer): string {
	const reason = answer.reuse === review_round_reuse.REUSE.HELD ? HELD_REASON : DELTA_REASON

	return answer.note === undefined ? reason : `${reason} — ${answer.note}`
}

function ran(answer: ReuseAnswer): string {
	return `${RAN_PREFIX}${answer.cause ?? UNNAMED_CAUSE}`
}

const run_ship_review_reason = { ran, reused }

export { run_ship_review_reason }
