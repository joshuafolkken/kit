import { FULL_PAGE_QUERY } from './git-gh-api-path'
import type { GhApiRequest } from './git-gh-exec'

// One pull request as `repos/{owner}/{repo}/pulls/{N}` answers it, the paths the reads ask for, and
// the router that answers them. The mapping tests, the read tests and the write tests all start from
// exactly these, so they live here rather than being written out three times — the clone `CLAUDE.md`
// prohibits (joshuafolkken/kit#1027).
const PR_BRANCH = 'feature-branch'
const PR_NUMBER = 972
const PR_HTML_URL = 'https://github.com/joshuafolkken/kit/pull/972'
const PR_API_URL = 'https://api.github.com/repos/joshuafolkken/kit/pulls/972'
const REPO_NAME_PATH = 'repos/{owner}/{repo}'
const EMPTY_LISTING = '[]'
const RATE_LIMITED = '{"message":"API rate limit exceeded"}'

// Newest first, spelled out rather than left to the endpoint's default — the lookup's fallback to
// the first row only means "the most recent one" while this ordering holds.
const LOOKUP_QUERY = 'state=all&sort=created&direction=desc&per_page=100'

// `{owner}` written as a constant: inside a template literal it reads as a broken interpolation.
const OWNER_PLACEHOLDER = '{owner}'

function pr_lookup_path(branch = PR_BRANCH): string {
	const head = `${OWNER_PLACEHOLDER}:${encodeURIComponent(branch)}`

	return `${REPO_NAME_PATH}/pulls?head=${head}&${LOOKUP_QUERY}`
}

// `gh api` expands `{owner}` and `{repo}` from the current repository, so every read below the
// branch lookup names the unqualified form. Spelled from `REPO_NAME_PATH` rather than written into
// a template literal, where the braces read as a broken interpolation.
function pr_detail_path(pr_number = PR_NUMBER): string {
	return `${REPO_NAME_PATH}/pulls/${String(pr_number)}`
}

// Both comment listings are read a full page at a time and paged through, so the query string is
// part of the path a test has to answer.
// The page size the reads themselves append, taken from the same constant rather than restated:
// a fixture spelling it out again would keep routing after the reads changed it.
const PAGE_QUERY = FULL_PAGE_QUERY
const COMMENTS_QUERY = PAGE_QUERY

function pr_conversation_comments_path(pr_number = PR_NUMBER): string {
	return `${REPO_NAME_PATH}/issues/${String(pr_number)}/comments${COMMENTS_QUERY}`
}

function pr_review_comments_path(pr_number = PR_NUMBER): string {
	return `${pr_detail_path(pr_number)}/comments${COMMENTS_QUERY}`
}

// The merge-gate snapshot's three listings. Two of them hang off the head *commit* rather than off
// the pull request, which is why the fixture carries a head SHA at all (joshuafolkken/kit#1028).
const PR_HEAD_SHA = 'c0ffee1c0ffee1c0ffee1c0ffee1c0ffee1c0ffe'

function pr_reviews_path(pr_number = PR_NUMBER): string {
	return `${pr_detail_path(pr_number)}/reviews${PAGE_QUERY}`
}

function commit_check_runs_path(commit_sha = PR_HEAD_SHA): string {
	return `${REPO_NAME_PATH}/commits/${commit_sha}/check-runs${PAGE_QUERY}`
}

function commit_status_path(commit_sha = PR_HEAD_SHA): string {
	return `${REPO_NAME_PATH}/commits/${commit_sha}/status${PAGE_QUERY}`
}

// `--paginate --slurp` answers an array of pages for both commit endpoints, so a fixture that is not
// wrapped would test a shape the reads never see.
function check_runs_pages(...pages: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>): string {
	return JSON.stringify(pages.map((check_runs) => ({ total_count: check_runs.length, check_runs })))
}

function status_pages(...pages: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>): string {
	return JSON.stringify(pages.map((statuses) => ({ state: 'success', statuses })))
}

// `state` is lower case and `url` is the API endpoint on purpose: those are two of the fields the
// mapping has to change, and a fixture that already carried the answer would test nothing.
function rest_pull(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		number: PR_NUMBER,
		state: 'open',
		url: PR_API_URL,
		html_url: PR_HTML_URL,
		head: { ref: PR_BRANCH, sha: PR_HEAD_SHA },
		...overrides,
	})
}

// One page of `repos/{owner}/{repo}/pulls`, whose elements are the same objects the single-pull
// endpoint answers with — minus `mergeable` and `mergeable_state`, which the listing omits.
function rest_pull_page(rows: ReadonlyArray<Record<string, unknown>>): string {
	return `[${rows.map((row) => rest_pull(row)).join(',')}]`
}

// A request routed by path rather than by call order: one read now asks for the repository name, the
// branch lookup and the pull request, and a path with no route fails loudly instead of answering the
// previous test's data.
function gh_api_routes(routes: Record<string, string>): (request: GhApiRequest) => Promise<string> {
	return async (request) => {
		const answer = routes[request.path]

		return answer === undefined
			? await Promise.reject(new Error(`unexpected gh api path: ${request.path}`))
			: await Promise.resolve(answer)
	}
}

// The routes every branch-keyed read needs: the branch lookup and the detail read.
function pr_routes(
	pull: Record<string, unknown> = {},
	extra: Record<string, string> = {},
): Record<string, string> {
	return {
		[pr_lookup_path()]: rest_pull_page([{}]),
		[pr_detail_path()]: rest_pull(pull),
		...extra,
	}
}

export {
	check_runs_pages,
	commit_check_runs_path,
	commit_status_path,
	gh_api_routes,
	pr_conversation_comments_path,
	pr_detail_path,
	pr_lookup_path,
	pr_review_comments_path,
	pr_reviews_path,
	pr_routes,
	status_pages,
	rest_pull,
	rest_pull_page,
	EMPTY_LISTING,
	PR_API_URL,
	PR_BRANCH,
	PR_HEAD_SHA,
	PR_HTML_URL,
	PR_NUMBER,
	RATE_LIMITED,
	REPO_NAME_PATH,
}
