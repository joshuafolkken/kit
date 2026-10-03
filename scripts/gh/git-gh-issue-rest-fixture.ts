// One issue as `repos/{owner}/{repo}/issues/{N}` answers it. Both the mapping tests
// (`git-gh-issue-rest.test.ts`) and the read tests (`git-gh-issue-read.test.ts`) start from exactly
// this response — one exercises the translation, the other the requests around it — so the builder
// lives here rather than being written out twice, which is the clone `CLAUDE.md` prohibits
// (joshuafolkken/kit#1024).

// The two REST paths the tests around this fixture build on. `gh api` expands the placeholders from
// the current repository, so they stay literal — and they live here, beside the response bodies,
// because a transport-shape change has to reach one definition rather than one per test file.
const CURRENT_REPO_ISSUES = 'repos/{owner}/{repo}/issues'
const BLOCKED_BY_SEGMENT = '/dependencies/blocked_by'

const ISSUE_NUMBER = 891
const ISSUE_TITLE = 'Fix login bug'
const ISSUE_BODY = 'the body'
const REPO_URL = 'https://github.com/joshuafolkken/kit'
const ISSUE_HTML_URL = `${REPO_URL}/issues/${String(ISSUE_NUMBER)}`
const ISSUE_API_URL = 'https://api.github.com/repos/joshuafolkken/kit/issues/891'
const ISSUE_CREATED_AT = '2026-08-01T09:00:00Z'
const ISSUE_LABEL = 'epic'
const BLOCKER_NUMBER = 1023

// `state` is lower case and `url` is the API endpoint on purpose: those are the two the mapping has
// to change, and a fixture that already carried the answer would test nothing.
function rest_issue(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		number: ISSUE_NUMBER,
		title: ISSUE_TITLE,
		body: ISSUE_BODY,
		state: 'open',
		url: ISSUE_API_URL,
		html_url: ISSUE_HTML_URL,
		created_at: ISSUE_CREATED_AT,
		labels: [{ name: ISSUE_LABEL }],
		...overrides,
	})
}

// One page of `repos/{owner}/{repo}/issues`, whose elements are the same objects the single-issue
// endpoint answers with — so the listing tests build their pages from the one response body above
// rather than writing a second one (joshuafolkken/kit#1025).
function rest_issue_page(rows: ReadonlyArray<Record<string, unknown>>): string {
	return `[${rows.map((row) => rest_issue(row)).join(',')}]`
}

// eslint-disable-next-line unicorn/no-null -- REST sends null for a pull request never merged
const NEVER_MERGED = null
const MERGED_AT = '2026-08-20T10:00:00Z'

function pull_html_url(number: number): string {
	return `${REPO_URL}/pull/${String(number)}`
}

const PULL_HTML_URL = pull_html_url(ISSUE_NUMBER)

// A pull request as the same endpoints serve it: `repos/{owner}/{repo}/issues` returns both, where
// `gh issue list` returned only issues, and `repos/{owner}/{repo}/issues/{N}` answers for one as
// readily as for an issue.
//
// `html_url` is the pull-request spelling because `/pull/` is what a pull request is *recognized* by
// once it has been read — `epic_issue.is_pull_request` looks for that segment
// (joshuafolkken/kit#947). Built from `number` rather than fixed, so a page of several pull requests
// does not have every row claiming to be the same one.
function rest_pull_request(
	number: number,
	merged_at: string | null = NEVER_MERGED,
): Record<string, unknown> {
	return { number, pull_request: { merged_at }, html_url: pull_html_url(number) }
}

// The dependency counts GitHub puts on every row of a listing. `total_blocked_by` is what decides
// whether a row costs a second request for its blocker relations.
function rest_dependencies_summary(total_blocked_by: number): Record<string, unknown> {
	return { issue_dependencies_summary: { total_blocked_by } }
}

// The dependencies endpoint answers full issue objects; only `number` and `state` survive the map.
function rest_blockers(state = 'closed'): string {
	return JSON.stringify([{ number: BLOCKER_NUMBER, state, html_url: ISSUE_HTML_URL }])
}

export {
	rest_issue,
	rest_issue_page,
	rest_pull_request,
	rest_dependencies_summary,
	rest_blockers,
	BLOCKED_BY_SEGMENT,
	BLOCKER_NUMBER,
	CURRENT_REPO_ISSUES,
	ISSUE_API_URL,
	ISSUE_BODY,
	ISSUE_CREATED_AT,
	ISSUE_HTML_URL,
	ISSUE_LABEL,
	ISSUE_NUMBER,
	ISSUE_TITLE,
	MERGED_AT,
	PULL_HTML_URL,
}
