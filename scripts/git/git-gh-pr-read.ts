import { FULL_PAGE_QUERY, git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'
import { git_gh_pr_rest, type RestPull } from './git-gh-pr-rest'

// Reading pull requests through REST, in the answers `gh pr view` used to give.
//
// `gh pr view` goes through GraphQL, which a cloud session is answered 403 for (joshuafolkken/kit#1022).
// The reads move to `gh api`, and every caller downstream keeps the contract it already reads — the
// empty string from `pr_view`, `false` from `pr_exists`, `undefined` from the two comment readers.
//
// One thing has no counterpart in REST: `gh pr view` accepted a **branch name** and every REST
// endpoint is keyed by **number**. The resolution below is the single place that bridges the two
// (joshuafolkken/kit#1027).

// The branch → number resolution, remembered for the life of the process.
//
// Without it the conversion would turn one request into two at six call sites: a `josh git` run
// alone asks `pr_exists`, `pr_view` and `pr_get_url` about the same branch, and `josh followup` adds
// `pr_get_body` and both comment readers. A pull request's number never changes, so the memo is
// sound for every one of them — with one exception, which is why `forget_pr_numbers` exists:
// `git-pr.ts` opens a *second* pull request on a branch whose first one merged, and a cached number
// would then keep answering with the merged one. `pr_create` clears it.
//
// **Only a resolved number is remembered.** A branch with no pull request is re-resolved every time,
// which is exactly the case `pr_create` is about to change, and a failed read is re-tried rather
// than remembered as an absence.
const pr_number_by_branch = new Map<string, number>()

function forget_pr_numbers(): void {
	pr_number_by_branch.clear()
}

// Newest first, and spelled out rather than left to the endpoint's default: `select_pull` falls back
// to the first row when no open pull request is on the branch, and that fallback only means "the
// most recent one" while this ordering holds.
const LOOKUP_QUERY = 'state=all&sort=created&direction=desc&per_page=100'
// The comment listings are paged: REST answers 30 rows by default, while `gh pr view --json comments`
// answered the whole conversation. Truncating them is the kit#973 failure again in another form — the
// newest Claude Review blocker falls off a listing that is ordered oldest first, and the merge gate
// finds nothing to stop on. `gh api --paginate` merges the pages of an array endpoint into one array,
// so the answer stays the flat listing every caller parses. The page size itself is
// `FULL_PAGE_QUERY`, shared with the merge-gate listings (joshuafolkken/kit#1028).
const COMMENTS_QUERY = FULL_PAGE_QUERY
// Written as a constant rather than inline: `{owner}` inside a template literal reads as a broken
// interpolation.
const OWNER_PLACEHOLDER = '{owner}'
const NO_HEAD_REF_MESSAGE = 'gh api answered a pull request with no head branch'
const FORK_HEAD_MESSAGE =
	'gh api answered a pull request whose head branch is in another repository'
// What a branch-keyed caller that cannot fold an absence into its own answer throws. Lives here
// rather than beside either caller: the merge-gate snapshot and the two branch-keyed writes all need
// it, and three copies of one message is the clone `CLAUDE.md` prohibits (joshuafolkken/kit#1029).
const NO_PULL_REQUEST_MESSAGE = 'gh api found no pull request for branch'
// And what it throws when the lookup never answered at all. Separate from the message above because
// the two are different diagnoses: one says the branch has nothing, the other says nobody looked
// (joshuafolkken/kit#1048).
const UNREADABLE_PULL_REQUEST_MESSAGE = 'gh api could not read the pull requests for branch'

// `head` names the owner of the head repository, which for every branch this tooling opens is the
// repository's own owner. `gh api` expands `{owner}` inside the query string as readily as inside
// the path, so the lookup costs no separate request to learn the name — and none of these reads
// gains a second way to fail. Only the branch is escaped: an expanded `{owner}` would not be.
function lookup_path(branch_name: string): string {
	const head = `${OWNER_PLACEHOLDER}:${encodeURIComponent(branch_name)}`

	return `${git_gh_api_path.pulls_api_path()}?head=${head}&${LOOKUP_QUERY}`
}

async function fetch_pr_number(branch_name: string): Promise<number | undefined> {
	const json = await git_gh_exec.exec_gh_api({ path: lookup_path(branch_name) })

	return git_gh_pr_rest.select_pull(git_gh_pr_rest.parse_rest_pulls(json))?.number
}

// Why the resolution produced no number. `missing` is the lookup answering: the listing came back and
// held no pull request for this branch. `unreadable` is the lookup failing — a rate limit, expired
// auth, a dropped connection, a 200 carrying something other than a listing.
//
// The vocabulary is `IssueRead`'s in `git-gh-issue-read.ts`, which tells the same two apart for an
// issue number (joshuafolkken/kit#957); reusing it rather than inventing a second spelling for one
// distinction is the point. The *classification* is cheaper here and needs no status probe: a branch
// with no pull request is a 200 with an empty listing rather than a 404, so the lookup's own outcome
// already separates them (joshuafolkken/kit#1048).
type PullNumberRead =
	{ kind: 'read'; pr_number: number } | { kind: 'missing' } | { kind: 'unreadable'; cause: unknown }

async function read_pr_number(branch_name: string): Promise<PullNumberRead> {
	const cached = pr_number_by_branch.get(branch_name)
	if (cached !== undefined) return { kind: 'read', pr_number: cached }

	try {
		const pr_number = await fetch_pr_number(branch_name)
		if (pr_number === undefined) return { kind: 'missing' }
		pr_number_by_branch.set(branch_name, pr_number)

		return { kind: 'read', pr_number }
	} catch (error) {
		return { kind: 'unreadable', cause: error }
	}
}

// `undefined` covers both "this branch has no pull request" and "the lookup failed", which is the
// distinction `gh pr view` never made either — every *read* here folds them together on purpose:
// `pr_exists` answers `false` either way, `pr_view` the empty string, the comment readers `undefined`.
async function resolve_pr_number(branch_name: string): Promise<number | undefined> {
	const read = await read_pr_number(branch_name)

	return read.kind === 'read' ? read.pr_number : undefined
}

// The number for a caller that has nothing to fold an absence into. The reads above answer their own
// empty value for a branch with no pull request; a write cannot — `gh pr comment <branch>` and
// `gh pr merge <branch>` both failed there, and the merge-gate snapshot already threw for the same
// reason. One throw shared by all three (joshuafolkken/kit#1029).
//
// **This is the caller the distinction exists for, and the only one that opts in.** Folding both into
// `NO_PULL_REQUEST_MESSAGE` reported a rate-limited lookup as "there is no pull request for this
// branch" — safe, in that the run stops without merging, but wrong about why, which is the
// joshuafolkken/kit#973 misread costing diagnosis time instead of correctness. The failure travels as
// the `cause`, so `git_error.handle` prints gh's own reason under 💡 Details
// (joshuafolkken/kit#1048).
async function require_pr_number(branch_name: string): Promise<number> {
	const read = await read_pr_number(branch_name)
	if (read.kind === 'read') return read.pr_number
	if (read.kind === 'missing') throw new Error(`${NO_PULL_REQUEST_MESSAGE}: ${branch_name}`)

	throw new Error(`${UNREADABLE_PULL_REQUEST_MESSAGE}: ${branch_name}`, { cause: read.cause })
}

async function read_pull(pr_number: number): Promise<RestPull> {
	const json = await git_gh_exec.exec_gh_api({
		path: git_gh_api_path.pull_api_path(String(pr_number)),
	})

	return git_gh_pr_rest.parse_rest_pull(json)
}

// One pull request named by its branch: the resolution, then the detail read that carries
// `mergeable` and `mergeable_state`, which the lookup listing does not.
async function read_pull_of_branch(branch_name: string): Promise<RestPull | undefined> {
	const pr_number = await resolve_pr_number(branch_name)
	if (pr_number === undefined) return undefined

	try {
		return await read_pull(pr_number)
	} catch {
		return undefined
	}
}

async function pr_exists(branch_name: string): Promise<boolean> {
	return (await resolve_pr_number(branch_name)) !== undefined
}

async function pr_get_number(branch_name: string): Promise<number | undefined> {
	return await resolve_pr_number(branch_name)
}

async function pr_get_url(branch_name: string): Promise<string | undefined> {
	const pull = await read_pull_of_branch(branch_name)
	if (pull?.html_url === undefined) return undefined

	return git_gh_helpers.parse_pr_state_string(pull.html_url)
}

// REST answers JSON null for a pull request with no body where `gh --json body` answered an empty
// string, and both used to arrive here as the empty answer this folds to `undefined`.
async function pr_get_body(branch_name: string): Promise<string | undefined> {
	const pull = await read_pull_of_branch(branch_name)
	const body = pull?.body

	return typeof body === 'string' && body.length > 0 ? body : undefined
}

// The empty string means "there is nothing to read" — a branch with no pull request, or a read that
// failed. `git-pr.ts` and `git-conflict.ts` both check the length before parsing.
async function pr_view(branch_name: string): Promise<string> {
	const pull = await read_pull_of_branch(branch_name)
	if (pull === undefined) return ''

	return JSON.stringify(git_gh_pr_rest.to_pr_info(pull))
}

// Already keyed by number, so no resolution is needed. It throws where the others fold to an empty
// answer, which is the contract `sync-dependabot-pins.ts` relies on: it checks out the branch it is
// handed, and a guessed one would push template pins onto the wrong PR.
async function pr_head_reference(pr_number: number): Promise<string> {
	const pull = await read_pull(pr_number)
	const reference = pull.head?.ref
	if (reference === undefined) throw new Error(NO_HEAD_REF_MESSAGE)
	// A fork's head is not on `origin` under this name, and `origin` may well carry a different branch
	// that answers to it. Refusing is the same contract the missing ref has: the caller checks out what
	// it is handed, so a guessed branch pushes template pins onto the wrong pull request.
	if (!git_gh_pr_rest.is_same_repository_head(pull)) throw new Error(FORK_HEAD_MESSAGE)

	return reference
}

// `undefined` when the listing could not be read — a failed request, or a PR whose number could not
// be resolved. Not `'[]'`, which every failure used to become.
//
// The two are the same string to a caller, and the callers are the merge gate: a rate limit arrived
// as "no reviewer left a finding" and the PR merged with the gate never actually read
// (joshuafolkken/kit#973). The direction is what makes it worse than the epic auto-close's version of
// the same misread — that one only failed to close something.
async function read_comments(
	branch_name: string,
	to_path: (pr_number: string) => string,
	to_json: (raw: string) => string,
): Promise<string | undefined> {
	const pr_number = await resolve_pr_number(branch_name)
	if (pr_number === undefined) return undefined
	const path = `${to_path(String(pr_number))}${COMMENTS_QUERY}`

	try {
		return to_json(await git_gh_exec.exec_gh_api({ path, should_paginate: true }))
	} catch {
		return undefined
	}
}

function to_comments_json(raw: string): string {
	return JSON.stringify(git_gh_pr_rest.to_pr_comments(raw))
}

// `git-pr-coderabbit.ts` parses `html_url` and `user.login` itself, so the review thread is handed on
// as REST serves it (joshuafolkken/kit#1023).
function as_served(raw: string): string {
	return raw
}

// The conversation comments, mapped back into the shape `gh pr view --json comments` answered with —
// `git-pr-ai-review.ts` reads `author.login` and `url`, which REST spells `user.login` / `html_url`.
async function pr_get_comments(branch_name: string): Promise<string | undefined> {
	return await read_comments(branch_name, git_gh_api_path.issue_comments_api_path, to_comments_json)
}

async function pr_get_review_comments(branch_name: string): Promise<string | undefined> {
	return await read_comments(branch_name, git_gh_api_path.pull_comments_api_path, as_served)
}

const git_gh_pr_read = {
	pr_exists,
	pr_get_number,
	pr_get_url,
	pr_get_body,
	pr_view,
	pr_head_reference,
	pr_get_comments,
	pr_get_review_comments,
}

// The merge-gate snapshot needs the same branch → number resolution and the same detail read, and it
// needs them separately: the reviews endpoint is keyed by number while the rollup is keyed by the
// head commit the detail carries. Exported rather than re-derived so the memo above stays one memo
// (joshuafolkken/kit#1028).
export {
	git_gh_pr_read,
	forget_pr_numbers,
	read_pull,
	require_pr_number,
	resolve_pr_number,
	FORK_HEAD_MESSAGE,
	NO_HEAD_REF_MESSAGE,
	NO_PULL_REQUEST_MESSAGE,
	UNREADABLE_PULL_REQUEST_MESSAGE,
}
