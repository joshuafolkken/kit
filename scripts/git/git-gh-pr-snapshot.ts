import { FULL_PAGE_QUERY, git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'
import { read_pull, require_pr_number } from './git-gh-pr-read'
import type { RestPull } from './git-gh-pr-rest'
import { git_gh_pr_review } from './git-gh-pr-review'
import { git_gh_pr_rollup } from './git-gh-pr-rollup'
import { to_gh_state } from './git-gh-rest-state'

// The merge gate's pull request state snapshot, rebuilt from REST.
//
// `gh pr view --json mergeStateStatus,reviewDecision,statusCheckRollup` is answered 403 in a cloud
// session (joshuafolkken/kit#1022), and all three fields are GraphQL-only: one has no REST
// counterpart at all, one is spelled differently, and one is two endpoints that `gh` merged.
// `pnpm josh followup --merge` decides a pull request is green from this value, so a mistake here
// ships as a merge no gate ever cleared rather than as a command that stops working
// (joshuafolkken/kit#1028).
//
// The answer stays the JSON string `parse_pr_state_snapshot` already parses. Nothing downstream —
// `git-pr-checks-parse.ts`, `git-pr-checks-eval.ts`, `git-pr-followup.ts` — changes.

const NO_HEAD_SHA_MESSAGE = 'gh api answered a pull request with no head commit'

// Both commit endpoints answer an *object* wrapping the listing, so `--paginate` alone would emit
// one document per page and `JSON.parse` would reject the pair; `--slurp` wraps the pages in one
// outer array instead (`git-gh-exec.ts` → `GhApiRequest`).
async function read_object_pages(path: string): Promise<string> {
	return await git_gh_exec.exec_gh_api({
		path: `${path}${FULL_PAGE_QUERY}`,
		should_paginate: true,
		should_slurp: true,
	})
}

// The reviews endpoint answers a bare array, whose pages `gh` merges into one array on its own —
// slurping it would produce `[[…],[…]]`, which the listing schema then rejects.
async function read_array_pages(path: string): Promise<string> {
	return await git_gh_exec.exec_gh_api({
		path: `${path}${FULL_PAGE_QUERY}`,
		should_paginate: true,
	})
}

function read_head_sha(pull: RestPull): string {
	const sha = pull.head?.sha
	if (sha === undefined) throw new Error(NO_HEAD_SHA_MESSAGE)

	return sha
}

// One pull request's rollup: the check runs and the status contexts, read from the head commit and
// merged back into the single array `gh` answered with.
async function read_status_check_rollup(commit_sha: string): Promise<Array<object>> {
	const [check_runs_json, status_json] = await Promise.all([
		read_object_pages(git_gh_api_path.commit_check_runs_api_path(commit_sha)),
		read_object_pages(git_gh_api_path.commit_status_api_path(commit_sha)),
	])

	return git_gh_pr_rollup.to_status_check_rollup({ check_runs_json, status_json })
}

// The review history, folded into GraphQL's `reviewDecision`. One request, and the only one of the
// four the merge gate does not need on every poll — see `is_review_decision_decisive`
// (joshuafolkken/kit#1043).
async function pr_get_review_decision(pr_number: number): Promise<string> {
	const path = git_gh_api_path.pull_reviews_api_path(String(pr_number))

	return git_gh_pr_review.to_review_decision(await read_array_pages(path))
}

// `mergeStateStatus` is upper-cased because that is the spelling `gh` used and the spelling
// `git-pr-checks-eval.ts` compares strictly against: `MERGE_STATE_CLEAN` never matches a lower-case
// `clean`, which would also take every pull request out of the kit#753 escape hatch keyed on
// `UNSTABLE`. The rule is shared with `to_pr_info` rather than written twice.
async function build_checks_fields(pull: RestPull): Promise<Record<string, unknown>> {
	return {
		statusCheckRollup: await read_status_check_rollup(read_head_sha(pull)),
		mergeStateStatus: to_gh_state(pull.mergeable_state),
	}
}

interface ResolvedPull {
	pr_number: number
	pull: RestPull
}

// The resolution and the detail read, which every path below needs and which the branch → number
// memo in `git-gh-pr-read.ts` makes free after the first poll.
async function resolve_pull(branch_name: string): Promise<ResolvedPull> {
	const pr_number = await require_pr_number(branch_name)

	return { pr_number, pull: await read_pull(pr_number) }
}

// Everything the snapshot carries except the review decision: three requests rather than four.
// `pr_number` travels with it so a caller that then *does* want the review decision needs no second
// resolution (joshuafolkken/kit#1043).
interface PrChecksSnapshot {
	pr_number: number
	snapshot_json: string
}

async function pr_get_checks_snapshot(branch_name: string): Promise<PrChecksSnapshot> {
	const { pr_number, pull } = await resolve_pull(branch_name)

	return { pr_number, snapshot_json: JSON.stringify(await build_checks_fields(pull)) }
}

// Throws where the branch has no pull request or a read fails, which is the contract `gh pr view`
// had: `git-pr-followup.ts` catches it and falls through to the poll, and folding a failure into an
// empty snapshot instead would read as "no checks, nothing requested" — green.
//
// **This is the definition the two halves above must compose to.** The merge gate reads them
// separately so it can skip the review listing on a poll that cannot conclude anything, but the
// three-field value `gh pr view --json …` answered with is still one thing, and it is asserted here
// rather than reassembled inside a test (joshuafolkken/kit#1043).
async function pr_get_state_snapshot(branch_name: string): Promise<string> {
	const { pr_number, pull } = await resolve_pull(branch_name)
	const [fields, review_decision] = await Promise.all([
		build_checks_fields(pull),
		pr_get_review_decision(pr_number),
	])

	return JSON.stringify({ ...fields, reviewDecision: review_decision })
}

const git_gh_pr_snapshot = {
	pr_get_state_snapshot,
	pr_get_checks_snapshot,
	pr_get_review_decision,
}

export type { PrChecksSnapshot }
export {
	git_gh_pr_snapshot,
	pr_get_state_snapshot,
	pr_get_checks_snapshot,
	pr_get_review_decision,
	NO_HEAD_SHA_MESSAGE,
}
