import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_branch_rules } from './git-gh-branch-rules'
import { git_gh_poll_read } from './git-gh-poll-read'
import { git_gh_pr_graphql_snapshot } from './git-gh-pr-graphql-snapshot'
import { git_gh_pr_graphql_state } from './git-gh-pr-graphql-state'
import { read_listed_pull, read_pull, require_pr_number } from './git-gh-pr-read'
import { git_gh_pr_rest, type RestPull } from './git-gh-pr-rest'
import { git_gh_pr_review } from './git-gh-pr-review'
import { git_gh_pr_rollup } from './git-gh-pr-rollup'
import { to_gh_state } from './git-gh-rest-state'

// The merge gate's pull request state snapshot. A session whose transport allows GraphQL reads it in
// one query (`git-gh-pr-graphql-snapshot.ts`, joshuafolkken/kit#6786); otherwise, or where that query
// does not answer, it is rebuilt from REST — GraphQL only for the merge state of a pull request whose
// REST detail GitHub refuses as too large or answers 304 (`resolve_pull`).
//
// `gh pr view --json mergeStateStatus,reviewDecision,statusCheckRollup` is answered 403 in a cloud
// session, and all three fields are GraphQL-only: one has no REST
// counterpart at all, one is spelled differently, and one is two endpoints that `gh` merged.
// `pnpm josh followup` decides a pull request is green from this value, so a mistake here
// ships as a merge no gate ever cleared rather than as a command that stops working.
//
// The answer stays the JSON string `parse_pr_state_snapshot` already parses. Nothing downstream —
// `git-pr-checks-parse.ts`, `git-pr-checks-eval.ts`, `git-pr-followup.ts` — changes.

const NO_HEAD_SHA_MESSAGE = 'gh api answered a pull request with no head commit'

function read_head_sha(pull: RestPull): string {
	const sha = pull.head?.sha
	if (sha === undefined) throw new Error(NO_HEAD_SHA_MESSAGE)

	return sha
}

// One pull request's rollup: the check runs and the status contexts, read from the head commit and
// merged back into the single array `gh` answered with. Both endpoints answer an *object* wrapping the
// listing, so their pages arrive slurped into one outer array (`git-gh-poll-read.ts`).
async function read_status_check_rollup(commit_sha: string): Promise<Array<object>> {
	const [check_runs_json, status_json] = await Promise.all([
		git_gh_poll_read.read_object_pages(git_gh_api_path.commit_check_runs_api_path(commit_sha)),
		git_gh_poll_read.read_object_pages(git_gh_api_path.commit_status_api_path(commit_sha)),
	])

	return git_gh_pr_rollup.to_status_check_rollup({ check_runs_json, status_json })
}

// The review history, folded into GraphQL's `reviewDecision`. One request, and the only one of the
// four the merge gate does not need on every poll — see `is_review_decision_decisive`.
async function read_rest_review_decision(pr_number: number): Promise<string> {
	const path = git_gh_api_path.pull_reviews_api_path(String(pr_number))

	return git_gh_pr_review.to_review_decision(await git_gh_poll_read.read_array_pages(path))
}

async function pr_get_review_decision(pr_number: number): Promise<string> {
	const graphql_decision = await git_gh_pr_graphql_snapshot.read_review_decision(pr_number)

	return graphql_decision ?? (await read_rest_review_decision(pr_number))
}

// `mergeStateStatus` is upper-cased because that is the spelling `gh` uses and the spelling
// `git-pr-checks-eval.ts` compares strictly against: `MERGE_STATE_CLEAN` never matches a lower-case
// `clean`, which would also take every pull request out of the CodeRabbit non-blocking exemption
// keyed on `UNSTABLE`. The rule is shared with `to_pr_info` rather than written twice.
//
// **`headRefOid` is the commit the rollup was read from**, in `gh`'s spelling, so a merge can be bound
// to the head whose checks passed rather than to whatever the branch points at by then (#4036).
//
// **`requiredContexts` is the base branch's required checks** (`git-gh-branch-rules.ts`), which the
// merge gate reads to accept an `UNSTABLE` pull request held only by an optional check.
//
// **`merged` is carried only once the pull request is in**, so the wait on an auto-merge reads it
// from the same detail read rather than a second one (joshuafolkken/kit#6721).
async function build_checks_fields(pull: RestPull): Promise<Record<string, unknown>> {
	const head_sha = read_head_sha(pull)
	const [rollup, required_contexts] = await Promise.all([
		read_status_check_rollup(head_sha),
		git_gh_branch_rules.read_required_contexts(pull.base?.ref),
	])

	return {
		statusCheckRollup: rollup,
		mergeStateStatus: to_gh_state(pull.mergeable_state),
		headRefOid: head_sha,
		requiredContexts: required_contexts,
		...(git_gh_pr_rest.is_merged(pull) && { merged: true }),
	}
}

interface ResolvedPull {
	pr_number: number
	pull: RestPull
}

// The resolution and the detail read, which every path below needs. The branch → number memo in
// `git-gh-pr-read.ts` makes the first free after the first poll.
//
// **A detail answered 304 keeps its body but not its `mergeable_state`.** GitHub computes that state
// lazily and can change it under an unchanged ETag, so a 304 alone kept the gate reading a stale
// `blocked` on a pull request that had turned `clean` (joshuafolkken/kit#4589). The state is read from
// GraphQL instead, which costs no REST core quota (joshuafolkken/kit#6721); where GraphQL does not
// answer, or the conditional read fails, the detail is read unconditionally as before.
async function read_polled_pull(pr_number: number): Promise<RestPull> {
	const polled = await git_gh_poll_read.read_detail(
		git_gh_api_path.pull_api_path(String(pr_number)),
	)
	if (polled === undefined) return await read_pull(pr_number)
	const pull = git_gh_pr_rest.parse_rest_pull(polled.body)
	if (!polled.is_unchanged) return pull
	const state = await git_gh_pr_graphql_state.try_read_merge_state(pull.node_id)

	return state === undefined ? await read_pull(pr_number) : { ...pull, mergeable_state: state }
}

// **A detail GitHub refuses as too many files changed** is stood in for by the listing row, whose
// missing `mergeable_state` is read from GraphQL (`git-gh-pr-graphql-state.ts`) — or the snapshot
// throws with the reason, since an unknown state would hold the gate pending until its budget ran out.
async function read_detail_or_listed(branch_name: string, pr_number: number): Promise<RestPull> {
	try {
		return await read_polled_pull(pr_number)
	} catch (error) {
		const listed = await read_listed_pull(error, branch_name, pr_number)
		if (listed === undefined) throw error
		const state = await git_gh_pr_graphql_state.read_merge_state_status(listed, error)

		return { ...listed, mergeable_state: state }
	}
}

async function resolve_pull(branch_name: string): Promise<ResolvedPull> {
	const pr_number = await require_pr_number(branch_name)

	return { pr_number, pull: await read_detail_or_listed(branch_name, pr_number) }
}

// Everything the snapshot carries except the review decision: three requests rather than four.
// `pr_number` travels with it so a caller that then *does* want the review decision needs no second
// resolution. **`graphql` is the decision the one GraphQL query already read**, so a poll round that
// wants it asks no second query (joshuafolkken/kit#7143); absent on the REST path.
interface PrChecksSnapshot {
	pr_number: number
	snapshot_json: string
	graphql?: { review_decision: string | undefined }
}

async function pr_get_checks_snapshot(branch_name: string): Promise<PrChecksSnapshot> {
	const graphql = await git_gh_pr_graphql_snapshot.read_snapshot(branch_name)

	if (graphql !== undefined) {
		return {
			pr_number: graphql.pr_number,
			snapshot_json: JSON.stringify(graphql.fields),
			graphql: { review_decision: graphql.review_decision },
		}
	}

	const { pr_number, pull } = await resolve_pull(branch_name)

	return { pr_number, snapshot_json: JSON.stringify(await build_checks_fields(pull)) }
}

// GraphQL's `null` decision is no answer (`to_review_decision`), so it is folded from the REST reviews.
async function graphql_or_rest_decision(
	decision: string | undefined,
	pr_number: number,
): Promise<string> {
	return decision ?? (await read_rest_review_decision(pr_number))
}

// The review decision of a snapshot already read: the GraphQL query's own where it answered one.
async function pr_read_review_decision(checks: PrChecksSnapshot): Promise<string> {
	if (checks.graphql === undefined) return await pr_get_review_decision(checks.pr_number)

	return await graphql_or_rest_decision(checks.graphql.review_decision, checks.pr_number)
}

// Throws where the branch has no pull request or a read fails, which is the contract `gh pr view`
// had: `git-pr-followup.ts` catches it and falls through to the poll, and folding a failure into an
// empty snapshot instead would read as "no checks, nothing requested" — green.
//
// **This is the definition the two halves above must compose to.** The merge gate reads them
// separately so it can skip the review listing on a poll that cannot conclude anything, but the
// three-field value `gh pr view --json …` answered with is still one thing, and it is asserted here
// rather than reassembled inside a test.
async function pr_get_state_snapshot(branch_name: string): Promise<string> {
	const graphql = await git_gh_pr_graphql_snapshot.read_snapshot(branch_name)

	if (graphql !== undefined) {
		const review_decision = await graphql_or_rest_decision(
			graphql.review_decision,
			graphql.pr_number,
		)

		return JSON.stringify({ ...graphql.fields, reviewDecision: review_decision })
	}

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
	pr_read_review_decision,
}

export {
	git_gh_pr_snapshot,
	pr_get_state_snapshot,
	pr_get_checks_snapshot,
	pr_get_review_decision,
	pr_read_review_decision,
	NO_HEAD_SHA_MESSAGE,
}
