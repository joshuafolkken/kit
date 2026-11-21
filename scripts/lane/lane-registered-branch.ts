import { git_gh_issue_merged_pull } from '#scripts/gh/git-gh-issue-merged-pull'
import { git_gh_pr_auto_merge } from '#scripts/gh/git-gh-pr-auto-merge'
import { lane_paths } from './lane-paths'
import { lane_pr_branch } from './lane-pr-branch'
import { lane_registry } from './lane-registry'

async function read(issue: string): Promise<string> {
	const lane = await lane_registry.find_open_lane(issue)

	if (lane !== undefined) return lane.branch

	const pulls = await git_gh_pr_auto_merge.pr_list_open_with_head_prefix(`${issue}-`)

	if (pulls.length > 0) return lane_pr_branch.select_branch(pulls, issue)

	return (
		(await git_gh_issue_merged_pull.pr_merged_head_of_issue(issue)) ?? lane_paths.lane_branch(issue)
	)
}

const lane_registered_branch = { read }

export { lane_registered_branch }
