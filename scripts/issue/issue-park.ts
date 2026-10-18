import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'

// A park on GitHub: the label that keeps an issue from being offered again, and the comment that says
// why. `run:park` (a lane child's `needs-decision`), `run:merge` and the ship relaunch cap (both
// `run:stalled`) park the same way, so the pair is written once here (joshuafolkken/kit#4132).
//
// **The label goes first and the comment only on it.** The label is what every offer reads; a comment
// on an issue whose label failed would explain a park that did not happen.

interface ParkWrite {
	is_labelled: boolean
	is_commented: boolean
}

async function apply(issue: string, label: string, body: string): Promise<ParkWrite> {
	const is_labelled = await git_gh_issue_write.issue_add_label(issue, label)

	if (!is_labelled) return { is_labelled, is_commented: false }

	const is_commented = await git_gh_issue_write.issue_try_comment(issue, body)

	return { is_labelled, is_commented }
}

const issue_park = { apply }

export type { ParkWrite }
export { issue_park }
