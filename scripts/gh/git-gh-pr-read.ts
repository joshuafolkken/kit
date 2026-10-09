import { FULL_PAGE_QUERY, git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'
import { git_gh_pr_rest, type RestPull } from './git-gh-pr-rest'
import { to_gh_state } from './git-gh-rest-state'

// Reading pull requests through REST, in the answers `gh pr view` gives.
//
// `gh pr view` goes through GraphQL, which a cloud session is answered 403 for.
// The reads move to `gh api`, and every caller downstream keeps the contract it already reads — the
// empty string from `pr_view`, `undefined` from the two comment readers. `pr_exists` is the one
// exception, and it is deliberate: it gates a **write**, so a lookup that failed cannot answer
// `false` there.
//
// One thing has no counterpart in REST: `gh pr view` accepted a **branch name** and every REST
// endpoint is keyed by **number**. The resolution below is the single place that bridges the two.

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

// Newest first, and spelled out rather than left to the endpoint's default: `select_pull` falls back
// to the first row when no open pull request is on the branch, and that fallback only means "the
// most recent one" while this ordering holds.
const LOOKUP_QUERY = 'state=all&sort=created&direction=desc&per_page=100'
// The comment listings are paged: REST answers 30 rows by default, while `gh pr view --json comments`
// answers the whole conversation. Truncating them lets the merge gate pass on a listing it never
// fully read — the newest Claude Review blocker falls off a listing that is ordered oldest first,
// and the merge gate finds nothing to stop on. `gh api --paginate` merges the pages of an array
// endpoint into one array, so the answer stays the flat listing every caller parses. The page size
// itself is `FULL_PAGE_QUERY`, shared with the merge-gate listings.
const COMMENTS_QUERY = FULL_PAGE_QUERY
// Written as a constant rather than inline: `{owner}` inside a template literal reads as a broken
// interpolation.
const OWNER_PLACEHOLDER = '{owner}'
// What a branch-keyed caller that cannot fold an absence into its own answer throws. Lives here
// rather than beside either caller: the merge-gate snapshot and the two branch-keyed writes all need
// it, and three copies of one message is the clone `CLAUDE.md` prohibits.
const NO_PULL_REQUEST_MESSAGE = 'gh api found no pull request for branch'
// And what it throws when the lookup never answered at all. Separate from the message above because
// the two are different diagnoses: one says the branch has nothing, the other says nobody looked.
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
// issue number; reusing it rather than inventing a second spelling for one
// distinction is the point. The *classification* is cheaper here and needs no status probe: a branch
// with no pull request is a 200 with an empty listing rather than a 404, so the lookup's own outcome
// already separates them.
interface PullMergeState {
	is_merged: boolean
	merged_at: string | undefined
	head_sha: string | undefined
	// `josh ship` reads `DIRTY` here to re-merge a conflicting pull request.
	merge_state_status: string | undefined
}

type PullNumberRead =
	{ kind: 'read'; pr_number: number } | { kind: 'missing' } | { kind: 'unreadable'; cause: unknown }

// The branch-keyed detail read, in the same three answers. `missing` and `unreadable` are the
// resolution's own; `unreadable` also covers a resolved number whose detail read failed, so no
// branch-keyed reader folds it into "no pull request".
type PullRead = Exclude<PullNumberRead, { kind: 'read' }> | { kind: 'read'; pull: RestPull }

// The lookups still in flight, keyed the same way the resolved numbers are.
const pending_pr_number_by_branch = new Map<string, Promise<PullNumberRead>>()

// The detail reads, keyed by number and remembered for the life of the command.
// `josh followup` asks `pr_get_body` and `pr_get_url` in one tick — the
// same `GET /pulls/{N}` each time. The promise is stored, so readers in one tick share the request as
// well as its answer; a read that fails is dropped and re-tried, the rule the number memo holds.
// **Every write to a pull request clears it** through `forget_pr_numbers`, and the two state readers
// never read it: `pr_get_merge_state` answers where the pull request stands *now*, which `josh ship`
// asks again after every merge it pushes, and `pr_view` decides whether `josh git -y` writes onto the
// pull request — after a commit and a push its preflight read would otherwise outlast.
const pull_by_number = new Map<number, Promise<RestPull>>()

async function fetch_pr_number_read(branch_name: string): Promise<PullNumberRead> {
	try {
		const pr_number = await fetch_pr_number(branch_name)
		if (pr_number === undefined) return { kind: 'missing' }
		pr_number_by_branch.set(branch_name, pr_number)

		return { kind: 'read', pr_number }
	} catch (error) {
		return { kind: 'unreadable', cause: error }
	}
}

// **The lookup in flight is shared, not only the number it resolves to**.
// The memo above answers a caller arriving *after* the first lookup returned, which was every caller
// while the branch-keyed reads were issued one at a time. `josh followup` now asks `pr_get_body` and
// `pr_get_url` about the same branch in the same tick, and two callers that both miss an empty map
// each fire their own `GET /pulls?head=…` — the second request this memo exists to remove,
// reappearing the moment the callers stopped being serial. Overlapping the reads must not cost a
// request it was meant to save.
//
// **A pending entry is dropped as soon as it settles**, so the property stated above is untouched:
// only a resolved number is *remembered*, and a `missing` or `unreadable` lookup is re-tried by the
// next caller rather than remembered as an absence.
async function start_pr_number_read(branch_name: string): Promise<PullNumberRead> {
	const pending = pending_pr_number_by_branch.get(branch_name)
	if (pending !== undefined) return await pending

	const lookup = fetch_pr_number_read(branch_name)

	pending_pr_number_by_branch.set(branch_name, lookup)

	try {
		return await lookup
	} finally {
		pending_pr_number_by_branch.delete(branch_name)
	}
}

// Defined after the maps it clears, so the memos are declared before anything reaches them.
function forget_pr_numbers(): void {
	pr_number_by_branch.clear()
	pending_pr_number_by_branch.clear()
	pull_by_number.clear()
}

async function read_pr_number(branch_name: string): Promise<PullNumberRead> {
	const cached = pr_number_by_branch.get(branch_name)
	if (cached !== undefined) return { kind: 'read', pr_number: cached }

	return await start_pr_number_read(branch_name)
}

// `undefined` covers both "this branch has no pull request" and "the lookup failed", which is the
// distinction `gh pr view` never made either — the *display* reads here fold them together on
// purpose: the comment readers answer `undefined` either way. The callers that act on the absence
// rather than displaying it — `require_pr_number`, `pr_exists` and `pr_view` — opt out.
async function resolve_pr_number(branch_name: string): Promise<number | undefined> {
	const read = await read_pr_number(branch_name)

	return read.kind === 'read' ? read.pr_number : undefined
}

// One definition, because both callers that refuse to fold an unreadable lookup raise it —
// `require_pr_number` and `pr_exists`.
function to_unreadable_error(branch_name: string, cause: unknown): Error {
	return new Error(`${UNREADABLE_PULL_REQUEST_MESSAGE}: ${branch_name}`, { cause })
}

// The number for a caller that has nothing to fold an absence into. The reads above answer their own
// empty value for a branch with no pull request; a write cannot — `gh pr comment <branch>` and
// `gh pr merge <branch>` both fail there, and the merge-gate snapshot throws for the same reason.
// One throw shared by all three.
//
// **This is the caller the distinction matters most for.** Folding both into
// `NO_PULL_REQUEST_MESSAGE` would report a rate-limited lookup as "there is no pull request for this
// branch" — safe, in that the run stops without merging, but wrong about why, which costs diagnosis
// time instead of correctness. The failure travels as
// the `cause`, so `git_error.handle` prints gh's own reason under 💡 Details.
async function require_pr_number(branch_name: string): Promise<number> {
	const read = await read_pr_number(branch_name)
	if (read.kind === 'read') return read.pr_number
	if (read.kind === 'missing') throw new Error(`${NO_PULL_REQUEST_MESSAGE}: ${branch_name}`)

	throw to_unreadable_error(branch_name, read.cause)
}

async function read_pull(pr_number: number): Promise<RestPull> {
	const json = await git_gh_exec.exec_gh_api({
		path: git_gh_api_path.pull_api_path(String(pr_number)),
	})

	return git_gh_pr_rest.parse_rest_pull(json)
}

// The identity check keeps a failure from evicting a read that `forget_pr_numbers` already replaced.
async function read_remembered_pull(pr_number: number): Promise<RestPull> {
	const pending = pull_by_number.get(pr_number) ?? read_pull(pr_number)

	pull_by_number.set(pr_number, pending)

	try {
		return await pending
	} catch (error) {
		if (pull_by_number.get(pr_number) === pending) pull_by_number.delete(pr_number)
		throw error
	}
}

// One pull request named by its branch: the resolution, then the detail read that carries
// `mergeable` and `mergeable_state`, which the lookup listing does not.
async function read_pull_of_branch(
	branch_name: string,
	read: (pr_number: number) => Promise<RestPull> = read_remembered_pull,
): Promise<PullRead> {
	const number_read = await read_pr_number(branch_name)
	if (number_read.kind !== 'read') return number_read

	try {
		return { kind: 'read', pull: await read(number_read.pr_number) }
	} catch (error) {
		return { kind: 'unreadable', cause: error }
	}
}

// The display readers' fold: "no pull request" and "nothing could be read" are one empty answer.
async function read_pull_or_undefined(branch_name: string): Promise<RestPull | undefined> {
	const read = await read_pull_of_branch(branch_name)

	return read.kind === 'read' ? read.pull : undefined
}

// **`false` means the branch has no pull request, and nothing else.** This is the same
// missing-versus-unreadable distinction, on the caller that needs it most: `pr_exists` is not read
// for display, it decides whether `git-pr.ts` **opens** a pull request. Folding an unreadable lookup
// into `false` would make a rate-limited run try to create a second pull request on a branch that
// already has one — surviving only if `pr_create`'s 422 → `PR_ALREADY_EXISTS` recovery caught it,
// which is an accident rather than a design. The throw is the one
// `require_pr_number` raises, so gh's own reason travels as the `cause`.
async function pr_exists(branch_name: string): Promise<boolean> {
	const read = await read_pr_number(branch_name)
	if (read.kind === 'unreadable') throw to_unreadable_error(branch_name, read.cause)

	return read.kind === 'read'
}

async function pr_get_number(branch_name: string): Promise<number | undefined> {
	return await resolve_pr_number(branch_name)
}

async function pr_get_url(branch_name: string): Promise<string | undefined> {
	const pull = await read_pull_or_undefined(branch_name)
	if (pull?.html_url === undefined) return undefined

	return git_gh_helpers.parse_pr_state_string(pull.html_url)
}

// **Where the branch's pull request stands** — a merge a person made by hand included:
// whether it merged and when, and the commit its head is on, which a push
// made on GitHub moves without touching the local branch. `undefined` covers both "no pull request"
// and "nothing could be read": `followup` then takes its ordinary path, whose merge step settles a
// pull request that did merge after all (`pr_merge`), so an unread answer costs a wait, not a wrong tail.
// Read past the detail memo: `josh ship` asks it again after each merge it pushes.
async function pr_get_merge_state(branch_name: string): Promise<PullMergeState | undefined> {
	const read = await read_pull_of_branch(branch_name, read_pull)
	if (read.kind !== 'read') return undefined
	const { pull } = read

	return {
		is_merged: git_gh_pr_rest.is_merged(pull),
		merged_at: pull.merged_at ?? undefined,
		head_sha: pull.head?.sha,
		merge_state_status: to_gh_state(pull.mergeable_state),
	}
}

// REST answers JSON null for a pull request with no body where `gh --json body` answers an empty
// string; both are the empty answer this folds to `undefined`.
async function pr_get_body(branch_name: string): Promise<string | undefined> {
	const pull = await read_pull_or_undefined(branch_name)
	const body = pull?.body

	return typeof body === 'string' && body.length > 0 ? body : undefined
}

// The empty string means "this branch has no pull request", and nothing else. A read that failed
// throws, carrying gh's reason as the `cause`: `git-pr.ts` decides from this state whether the
// branch's pull request merged, and a rate limit answered as "no state" sent a merged pull request
// down the open one's path. Read past the detail memo, like the merge state.
async function pr_view(branch_name: string): Promise<string> {
	const read = await read_pull_of_branch(branch_name, read_pull)
	if (read.kind === 'unreadable') throw to_unreadable_error(branch_name, read.cause)
	if (read.kind === 'missing') return ''

	return JSON.stringify(git_gh_pr_rest.to_pr_info(read.pull))
}

// `undefined` when the listing could not be read — a failed request, or a PR whose number could not
// be resolved. Not `'[]'`.
//
// The two are the same string to a caller, and the callers are the merge gate: a rate limit would
// arrive as "no reviewer left a finding" and the PR merge with the gate never actually read.
// The direction is what makes it worse than the epic auto-close's version of
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
// as REST serves it.
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
	pr_get_merge_state,
	pr_view,
	pr_get_comments,
	pr_get_review_comments,
}

// The merge-gate snapshot needs the same branch → number resolution and the same detail read, and it
// needs them separately: the reviews endpoint is keyed by number while the rollup is keyed by the
// head commit the detail carries. Exported rather than re-derived so the memo above stays one memo.
export type { PullMergeState }
export {
	git_gh_pr_read,
	forget_pr_numbers,
	read_pull,
	require_pr_number,
	resolve_pr_number,
	NO_PULL_REQUEST_MESSAGE,
	UNREADABLE_PULL_REQUEST_MESSAGE,
}
