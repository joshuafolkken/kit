// One issue as `repos/{owner}/{repo}/issues/{N}` answers it. Both the mapping tests
// (`git-gh-issue-rest.test.ts`) and the read tests (`git-gh-issue-read.test.ts`) start from exactly
// this response — one exercises the translation, the other the requests around it — so the builder
// lives here rather than being written out twice, which is the clone `CLAUDE.md` prohibits
// (joshuafolkken/kit#1024).
const ISSUE_NUMBER = 891
const ISSUE_TITLE = 'Fix login bug'
const ISSUE_BODY = 'the body'
const ISSUE_HTML_URL = 'https://github.com/joshuafolkken/kit/issues/891'
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

// The dependencies endpoint answers full issue objects; only `number` and `state` survive the map.
function rest_blockers(state = 'closed'): string {
	return JSON.stringify([{ number: BLOCKER_NUMBER, state, html_url: ISSUE_HTML_URL }])
}

export {
	rest_issue,
	rest_blockers,
	BLOCKER_NUMBER,
	ISSUE_API_URL,
	ISSUE_BODY,
	ISSUE_CREATED_AT,
	ISSUE_HTML_URL,
	ISSUE_LABEL,
	ISSUE_NUMBER,
	ISSUE_TITLE,
}
