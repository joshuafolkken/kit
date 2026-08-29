import { z } from 'zod'
import { MERGED_STATE, to_gh_state } from './git-gh-rest-state'
import { parse_json_array_or_undefined, parse_json_object_safe } from './parse-json-array'

// The translation between one REST pull request (`repos/{owner}/{repo}/pulls/{N}`) and the JSON
// shape `gh pr view --json <fields>` used to answer with.
//
// `gh pr view` goes through GraphQL, which a cloud session is answered 403 for while the REST
// endpoint is served normally (joshuafolkken/kit#1022). The mapping lives here rather than beside
// the requests because it is pure: given the response, it decides the answer with nothing else to
// know — the same split `git-gh-issue-rest.ts` already makes (joshuafolkken/kit#1027).

// Only the fields the mapping itself reads are named; every other key passes through untouched.
//
// `number` is required so that a 200 carrying something other than a pull request — a proxy's HTML
// error page, an API message object — fails the parse rather than passing as a pull request whose
// every field is missing. `pr_view` would otherwise answer a well-formed JSON object with no state
// in it, which `git-pr.ts` reads as "the state could not be determined" and `git-conflict.ts` reads
// as "no conflict".
//
// `mergeable` and `mergeable_state` are served by the single-pull endpoint only — the listing omits
// both — which is why the branch lookup resolves a number and the reads go back for the detail.
// `repo.full_name` is what tells a fork's head from this repository's own — `head.ref` is a bare
// branch name that says nothing about which repository holds it (joshuafolkken/kit#1029). Named once
// because both sides of a pull request carry the same shape.
const rest_repo_schema = z.looseObject({ full_name: z.string().optional() }).nullish()
const rest_pull_side_schema = z.looseObject({ repo: rest_repo_schema })

type RestPullSide = z.infer<typeof rest_pull_side_schema>

const rest_pull_schema = z.looseObject({
	number: z.number(),
	html_url: z.string().optional(),
	body: z.string().nullish(),
	state: z.string().optional(),
	merged: z.boolean().nullish(),
	merged_at: z.string().nullish(),
	mergeable: z.boolean().nullish(),
	mergeable_state: z.string().optional(),
	// `sha` is the head commit, which is what both halves of the merge-gate rollup are keyed by —
	// REST hangs the check runs and the status contexts off the commit rather than off the pull
	// request (joshuafolkken/kit#1028).
	head: z
		.looseObject({ ref: z.string().optional(), sha: z.string().optional(), repo: rest_repo_schema })
		.nullish(),
	base: rest_pull_side_schema.nullish(),
})

type RestPull = z.infer<typeof rest_pull_schema>

// One conversation comment as `repos/{owner}/{repo}/issues/{N}/comments` serves it.
// `ai_review_pull_comment_schema` reads `author.login` and `url`, which REST spells `user.login` and
// `html_url`.
const rest_comment_schema = z.looseObject({
	body: z.string().nullish(),
	html_url: z.string().optional(),
	user: z.looseObject({ login: z.string().optional() }).nullish(),
})

const NOT_A_PULL_MESSAGE = 'gh api answered something other than a pull request object'
const NOT_A_PULL_LISTING_MESSAGE = 'gh api answered something other than a pull request listing'
const NOT_A_COMMENT_LISTING_MESSAGE = 'gh api answered something other than a comment listing'

const OPEN_STATE = 'open'
const EMPTY_BODY = ''

function parse_rest_pull(rest_json: string): RestPull {
	const parsed = parse_json_object_safe(rest_json, rest_pull_schema)
	if (parsed === undefined) throw new Error(NOT_A_PULL_MESSAGE)

	return parsed
}

// A response that is not a listing must not degrade into an empty one: `pr_exists` reads an empty
// listing as "this branch has no pull request", and `git-pr.ts` answers that by opening a second one
// (joshuafolkken/kit#950 is the same misread on the issue side).
function parse_rest_pulls(rest_json: string): Array<RestPull> {
	const parsed = parse_json_array_or_undefined(rest_json, rest_pull_schema)
	if (parsed === undefined) throw new Error(NOT_A_PULL_LISTING_MESSAGE)

	return parsed
}

// Which pull request a branch name means. `gh pr view <branch>` preferred the open one and fell back
// to the most recent, and the difference is reachable in this repository's own flow: `git-pr.ts`
// opens a *second* pull request on a branch whose first one merged, so a lookup that answered
// "newest first, whatever its state" would still be right there while "the first row" alone would
// not be once GitHub's ordering is left to a default. The caller asks newest-first, so the fallback
// is the newest.
function select_pull(pulls: ReadonlyArray<RestPull>): RestPull | undefined {
	return pulls.find((pull) => pull.state === OPEN_STATE) ?? pulls[0]
}

// REST reports a merge as a field beside the state rather than as a state, and both spellings of it
// are accepted: the single-pull endpoint carries `merged`, the listing carries only `merged_at`.
function is_merged(pull: RestPull): boolean {
	return pull.merged === true || typeof pull.merged_at === 'string'
}

// `gh` answered three values where REST answers two. `git-pr.ts` compares against `MERGED` to decide
// whether the branch needs a fresh pull request, so folding a merged one into `CLOSED` would leave
// it waiting on checks that will never run again.
function to_pr_state(pull: RestPull): string | undefined {
	return is_merged(pull) ? MERGED_STATE : to_gh_state(pull.state)
}

// Whether the head branch lives in this repository rather than in a fork.
//
// `gh pr checkout` reached a fork's head through `refs/pull/<N>/head`, which a plain
// `git fetch origin <branch>` cannot: the fetch either fails outright, or — where `origin` happens to
// carry a branch of the same name — succeeds on an unrelated branch. Both halves are read out of the
// one response, so the test costs no second request (joshuafolkken/kit#1029).
function to_repo_name(side: RestPullSide | null | undefined): string | undefined {
	return side?.repo?.full_name
}

function is_same_repository_head(pull: RestPull): boolean {
	const head_repo = to_repo_name(pull.head)

	return head_repo !== undefined && head_repo === to_repo_name(pull.base)
}

// The three fields `gh pr view --json mergeable,mergeStateStatus,state` answered with.
//
// `mergeable` was a GraphQL enum (`MERGEABLE` / `CONFLICTING` / `UNKNOWN`) and is a nullable boolean
// in REST; `pr_info_schema` accepts both and `git-conflict.ts` already reads `false` as conflicting,
// so the boolean passes through as it arrives — including the JSON null GitHub sends while it is
// still computing, which reads as "not conflicting" exactly as the enum's `UNKNOWN` did.
//
// `mergeStateStatus` is upper-cased because that is how `gh` spelled it — `git-conflict.ts`
// lower-cases before comparing and is indifferent, but the merge-gate snapshot in
// `git-pr-checks-eval.ts` compares strictly, and one casing across both readers is what keeps that
// true (joshuafolkken/kit#1028 converts the snapshot itself).
function to_pr_info(pull: RestPull): Record<string, unknown> {
	return {
		mergeable: pull.mergeable,
		mergeStateStatus: to_gh_state(pull.mergeable_state),
		state: to_pr_state(pull),
	}
}

// The conversation comments in the shape `gh pr view --json comments` answered with. A listing that
// will not parse throws rather than answering an empty one — `git-pr-ai-review.ts` reads an empty
// listing as "no reviewer left a finding" and merges (joshuafolkken/kit#973).
function to_pr_comments(rest_json: string): Array<Record<string, unknown>> {
	const parsed = parse_json_array_or_undefined(rest_json, rest_comment_schema)
	if (parsed === undefined) throw new Error(NOT_A_COMMENT_LISTING_MESSAGE)

	return parsed.map((comment) => ({
		body: comment.body ?? EMPTY_BODY,
		url: comment.html_url,
		author: { login: comment.user?.login },
	}))
}

const git_gh_pr_rest = {
	parse_rest_pull,
	parse_rest_pulls,
	select_pull,
	is_same_repository_head,
	to_pr_state,
	to_pr_info,
	to_pr_comments,
}

export type { RestPull }
export { git_gh_pr_rest }
