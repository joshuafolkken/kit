import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { error_text } from '#scripts/lib/error-message'
import { review_round_reuse, type ReuseAnswer } from './review-round-reuse'

// joshuafolkken/kit#4850: once a lane child has recorded round 1 on a tree `josh ship` reuses, round 2
// is the ship's. The rule stood in `chain-rule.md` step 0 as prose alone (joshuafolkken/kit#4830), and
// the next lane reopened `run:review` after reading it, running a round 2 the ship then ran again. So
// `run:review` refuses that reopen and `review:record` names the ship as the next step.
//
// **A round the ship would review again is not handed over**: `review:record --check` then tells the
// lane to run round 1 itself, so `run:review` stays open for it.

const SHIP_STEP = 'pnpm josh ship --detach --review "<title> #<N>"'
const NEXT_STEP_LINE = `Next: hand over to \`${SHIP_STEP}\` — round 2 is the ship's; never reopen \`run:review\` (chain-rule.md step 0).`

// A reuse question git could not answer reads as not reused: the lane then reviews the round itself,
// which costs one review, rather than leaving it to a ship that may review it again detached.
// The stale read inside it fails open in `review_round_reuse.is_stale_here`, as the ship's probe reads it.
const UNANSWERED_CAUSE = 'git could not answer the reuse question'

async function answer_here(issue: number): Promise<ReuseAnswer> {
	try {
		return await review_round_reuse.answer_here(issue)
	} catch (error) {
		error_text.trace_swallowed('review_lane_handover.answer_here', error)

		return { reuse: review_round_reuse.REUSE.AGAIN, cause: UNANSWERED_CAUSE }
	}
}

async function is_reused_here(issue: number): Promise<boolean> {
	const answer = await answer_here(issue)

	return answer.reuse !== review_round_reuse.REUSE.AGAIN
}

// The mark must name this issue as well as this checkout, so a person's run — or a branch whose issue
// is not the lane's — is never refused.
function is_lane_child_of(issue: number): boolean {
	if (lane_child_marker.marked_issue() !== String(issue)) return false

	return lane_child_marker.is_child_of(PROJECT_ROOT)
}

// Reuse already requires the recorded round (`review_round_reuse.is_reusable`), so it answers both.
async function is_handed_over(issue: number): Promise<boolean> {
	if (!is_lane_child_of(issue)) return false

	return await is_reused_here(issue)
}

function refusal(issue: number): string {
	return (
		`⛔ run:review: round 1 of ${session_cite.issue(issue)} is recorded and josh ship reuses it, and this is a ` +
		`dispatched lane child (\`${lane_child_marker.KEY}\`), so no brief is minted. ${NEXT_STEP_LINE}`
	)
}

const review_lane_handover = {
	NEXT_STEP_LINE,
	answer_here,
	is_handed_over,
	refusal,
}

export { review_lane_handover }
