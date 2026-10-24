import { issue_watch_gate } from '#scripts/issue/issue-watch-gate'
import { error_text } from '#scripts/lib/error-message'
import { review_record } from './review-record'
import { review_reviewed_tree } from './review-reviewed-tree'

// Whether `josh ship` reuses the recorded round 1 rather than reviewing it again — asked by the ship
// and by `josh review:record --check`, so a lane resuming on an old record reads the ship's own answer
// rather than mistaking "recorded" for "reused" (joshuafolkken/kit#4763).

// The issue changed after the recorded review was briefed — the refusal `josh followup` would make
// (joshuafolkken/kit#4221). A read that fails reads as fresh: `josh followup` still refuses a stale
// review at the merge.
async function is_stale_here(): Promise<boolean> {
	try {
		return (await issue_watch_gate.review_refusal_here()) !== undefined
	} catch (error) {
		error_text.trace_swallowed('review_round_reuse.is_stale_here', error)

		return false
	}
}

// **A recorded round 1 is reused while the tree it was recorded on holds still** — a lane's review
// before the ship (joshuafolkken/kit#4620) — **or after the ship's own round 1 stopped on a finding**,
// however the lane's fix moved the tree: that fix delta is round 2's after the commit. Any other tree
// that moved since is reviewed again, from that record (`review-reviewed-tree.ts`), so the round reads
// the delta alone. An issue that changed after that round's brief is never reused: the recorded
// round never read it, and `josh followup` refuses the merge on it (joshuafolkken/kit#4221).
async function is_reusable(issue: number, is_stale: boolean): Promise<boolean> {
	if (is_stale) return false

	const recorded = await review_record.check(issue)

	if (recorded.status !== 'ok') return false

	return review_reviewed_tree.is_stopped_on(issue) || (await review_reviewed_tree.is_unmoved_here())
}

// The ship's own answer for this checkout, asked before the ship runs; a git failure throws.
async function is_reusable_here(issue: number): Promise<boolean> {
	return await is_reusable(issue, await is_stale_here())
}

const review_round_reuse = { is_reusable, is_reusable_here, is_stale_here }

export { review_round_reuse }
