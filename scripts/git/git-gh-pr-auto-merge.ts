import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'
import { read_pull, require_pr_number } from './git-gh-pr-read'
import { git_gh_pr_rest, type RestPull } from './git-gh-pr-rest'

// Auto-merge for a pull request a josh command opens and would otherwise have to stay alive to land
// (joshuafolkken/kit#2497). `pnpm josh observations:flush` used to merge its pull request only from
// inside its own wait, so a wait that ended early — a session cut, a killed process — left a green
// pull request open with nobody to merge it.
//
// **This is the one GraphQL request in the pull-request layer, because REST has no equivalent.**
// Enabling auto-merge is `enablePullRequestAutoMerge` and nothing else. A cloud session can be
// answered 403 for GraphQL (joshuafolkken/kit#1022), so the caller treats a failure here as a lost
// safety net rather than a failed command — the in-process wait still merges as it always did.

const GRAPHQL_PATH = 'graphql'
const OPEN_PULLS_QUERY = `${git_gh_api_path.FULL_PAGE_QUERY}&state=open`
const MISSING_NODE_ID_MESSAGE = 'gh api answered a pull request without a node_id'
const ENABLE_AUTO_MERGE_MUTATION =
	'mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: MERGE }) { clientMutationId } }'

interface OpenPull {
	number: number
	head_ref: string
	has_auto_merge: boolean
}

async function pr_enable_auto_merge(branch_name: string): Promise<void> {
	const pull = await read_pull(await require_pr_number(branch_name))
	if (pull.node_id === undefined) throw new Error(MISSING_NODE_ID_MESSAGE)

	await git_gh_exec.exec_gh_api({
		path: GRAPHQL_PATH,
		body: JSON.stringify({ query: ENABLE_AUTO_MERGE_MUTATION, variables: { id: pull.node_id } }),
	})
}

// **A read that failed answers "not yet" rather than throwing**, because the caller polls it: the
// next attempt asks again, and running out of attempts is what ends the wait.
async function pr_is_merged(branch_name: string): Promise<boolean> {
	try {
		return git_gh_pr_rest.is_merged(await read_pull(await require_pr_number(branch_name)))
	} catch {
		return false
	}
}

function head_reference_of(pull: RestPull): string {
	return pull.head?.ref ?? ''
}

function has_head_prefix(pull: RestPull, prefix: string): boolean {
	return git_gh_pr_rest.is_same_repository_head(pull) && head_reference_of(pull).startsWith(prefix)
}

// The listing carries `auto_merge`, so no detail read is needed; whether the checks still let it land
// is the merge gate's question (`git_pr_checks.read_merge_progress`), asked by the caller.
function to_open_pull(pull: RestPull): OpenPull {
	return {
		number: pull.number,
		head_ref: head_reference_of(pull),
		has_auto_merge: pull.auto_merge !== null && pull.auto_merge !== undefined,
	}
}

async function pr_list_open_with_head_prefix(prefix: string): Promise<ReadonlyArray<OpenPull>> {
	const json = await git_gh_exec.exec_gh_api({
		path: `${git_gh_api_path.pulls_api_path()}${OPEN_PULLS_QUERY}`,
		should_paginate: true,
	})

	return git_gh_pr_rest
		.parse_rest_pulls(json)
		.filter((pull) => has_head_prefix(pull, prefix))
		.map((pull) => to_open_pull(pull))
}

const git_gh_pr_auto_merge = {
	pr_enable_auto_merge,
	pr_is_merged,
	pr_list_open_with_head_prefix,
}

export type { OpenPull }
export { git_gh_pr_auto_merge, ENABLE_AUTO_MERGE_MUTATION }
