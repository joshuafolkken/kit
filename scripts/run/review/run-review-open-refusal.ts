import { metrics_totals } from '#scripts/gate/metrics-totals'
import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { review_lane_handover } from '#scripts/review/review-lane-handover'
import { run_review_unplanned } from './run-review-unplanned'

// The stops `josh run:review`'s open checks before anything is launched, first one wins. The ship's own
// `--code-only` open is never refused: it has just passed the ship's pre-detach and preflight.

// A lane child's reopen after an attested round 1 is refused, a widened plan included
// (`review-lane-handover.ts`).
async function handover_refusal(): Promise<string | undefined> {
	const issue = git_branch.issue_from_branch(await git_command.branch())
	if (issue === undefined) return undefined

	return (await review_lane_handover.is_reopen_refused(issue))
		? review_lane_handover.refusal(issue)
		: undefined
}

// A metrics total grown past every approval stops the open, right after the implementation and before
// anything is launched, rather than the ship's pre-detach after the review (joshuafolkken/kit#6023).
// An unplanned file's overlap stops it while the file can still be dropped (joshuafolkken/kit#6142).
async function refusal(is_code_only: boolean): Promise<string | undefined> {
	if (is_code_only) return undefined

	return (
		(await handover_refusal()) ??
		(await metrics_totals.totals_refusal(PROJECT_ROOT)) ??
		(await run_review_unplanned.refusal())
	)
}

const run_review_open_refusal = {
	refusal,
}

export { run_review_open_refusal }
