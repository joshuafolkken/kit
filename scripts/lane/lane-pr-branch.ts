import { git_gh_pr_auto_merge, type OpenPull } from '#scripts/gh/git-gh-pr-auto-merge'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_paths } from './lane-paths'
import type { LaneInfo } from './lane-registry'
import { lane_start_point } from './lane-start-point'

interface LaneBranch {
	branch: string
	start_point: string | undefined
}

function pull_description(pull: OpenPull): string {
	return `${session_cite.issue(pull.number)} (${pull.head_ref})`
}

function select_branch(pulls: ReadonlyArray<OpenPull>, issue: string, existing?: LaneInfo): string {
	if (pulls.length > 1) {
		throw new Error(
			`Multiple open pull requests for ${session_cite.issue(issue)}: ${pulls.map((pull) => pull_description(pull)).join(', ')}. Resolve the duplicate pull requests before reopening the lane.`,
		)
	}

	return (
		pulls[0]?.head_ref ?? (existing === undefined ? lane_paths.lane_branch(issue) : existing.branch)
	)
}

function guard_existing(issue: string, branch: string, existing?: LaneInfo): void {
	if (existing === undefined) return

	if (existing.branch !== branch) {
		throw new Error(
			`Lane ${session_cite.issue(issue)} is on ${existing.branch}, but its open pull request is on ${branch}. Close the stopped lane with \`pnpm josh lane:close ${issue}\`, then reopen it with \`pnpm josh lane:open ${issue}\` to preserve the pull request.`,
		)
	}
}

// Keep the PR's head name: ship updates the PR belonging to the current branch.
// A failed listing must propagate, since it cannot establish that a new branch is safe.
async function resolve(issue: string, existing?: LaneInfo): Promise<LaneBranch> {
	const pulls = await git_gh_pr_auto_merge.pr_list_open_with_head_prefix(`${issue}-`)
	const branch = select_branch(pulls, issue, existing)

	guard_existing(issue, branch, existing)

	const start_point =
		existing === undefined
			? await lane_start_point.resolve_for_branch(branch, pulls.length > 0)
			: undefined

	return { branch, start_point }
}

const lane_pr_branch = { resolve }

export type { LaneBranch }
export { lane_pr_branch }
