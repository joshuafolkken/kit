import { describe, expect, it } from 'vitest'
import { git_gh_issue_rest } from './git-gh-issue-rest'
import {
	BLOCKER_NUMBER,
	ISSUE_BODY,
	ISSUE_CREATED_AT,
	ISSUE_HTML_URL,
	ISSUE_LABEL,
	ISSUE_NUMBER,
	ISSUE_TITLE,
	PULL_HTML_URL,
	rest_blockers,
	rest_issue,
} from './git-gh-issue-rest-fixture'
import {
	blocked_by_schema,
	blocking_issue_schema,
	epic_child_schema,
	epic_subject_schema,
} from './schemas'

// joshuafolkken/kit#1024: `gh issue view --json` and `repos/{owner}/{repo}/issues/{N}` disagree on
// field names and on the casing of `state`, so a read moved to REST answers a shape no epic command
// can read unless the two are translated.

const EXACT_BLOCKER_TOTAL = 3
const EMPTY_LISTING = '[]'

function map(fields: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return git_gh_issue_rest.to_gh_issue(
		git_gh_issue_rest.parse_rest_issue(rest_issue(overrides)),
		git_gh_issue_rest.split_fields(fields),
	)
}

describe('to_gh_issue — the fields whose names or values differ', () => {
	// REST answers `open` / `closed`; every reader compares against `gh`'s upper-case spelling, so a
	// pass-through would have `epic_issue.is_open` answer false for every open issue.
	it('upper-cases the state', () => {
		expect(map('state')).toEqual({ state: 'OPEN' })
	})

	it('upper-cases a closed state too', () => {
		expect(map('state', { state: 'closed' })).toEqual({ state: 'CLOSED' })
	})

	// `gh issue view` reported a merged pull request as `MERGED`, and `epic_issue.normalize_state`
	// maps everything that is not `CLOSED` to `OPEN` — the loud side. REST answers `closed`, so
	// passing it through would let an epic auto-close on a pull request pasted into its task list.
	it('keeps a merged pull request reported as MERGED rather than CLOSED', () => {
		const merged = { state: 'closed', pull_request: { merged_at: '2026-08-29T09:30:52Z' } }

		expect(map('state', merged)).toEqual({ state: 'MERGED' })
	})

	it('reports a closed but unmerged pull request as CLOSED', () => {
		// eslint-disable-next-line unicorn/no-null -- REST sends null for a pull request never merged
		const rejected = { state: 'closed', pull_request: { merged_at: null } }

		expect(map('state', rejected)).toEqual({ state: 'CLOSED' })
	})

	it('reports an open pull request as OPEN', () => {
		// eslint-disable-next-line unicorn/no-null -- REST sends null for a pull request never merged
		const open_pull = { state: 'open', pull_request: { merged_at: null } }

		expect(map('state', open_pull)).toEqual({ state: 'OPEN' })
	})

	it('reads createdAt from created_at', () => {
		expect(map('createdAt')).toEqual({ createdAt: ISSUE_CREATED_AT })
	})

	// The one that bites: REST's `url` is the API endpoint, and `epic_issue.is_pull_request` decides
	// from `/pull/` appearing in the browser URL — which the endpoint never carries.
	it('reads url from html_url rather than from the API endpoint', () => {
		expect(map('url')).toEqual({ url: ISSUE_HTML_URL })
	})

	it('keeps a pull request identifiable by its browser URL', () => {
		expect(map('url', { html_url: PULL_HTML_URL })).toEqual({ url: PULL_HTML_URL })
	})
})

describe('to_gh_issue — the fields that pass through', () => {
	// REST answers JSON null for an issue with no body; `gh --json body` answered an empty string,
	// and `issue_get_body` hands the result straight to callers that expect text.
	it('reads a null body as the empty string', () => {
		// eslint-disable-next-line unicorn/no-null -- the value REST actually sends for an empty body
		expect(map('body', { body: null })).toEqual({ body: '' })
	})

	it('keeps a body that is there', () => {
		expect(map('body')).toEqual({ body: ISSUE_BODY })
	})

	it('passes labels through as objects carrying a name', () => {
		expect(map('labels')).toEqual({ labels: [{ name: ISSUE_LABEL }] })
	})

	it('answers every requested field in one object', () => {
		expect(map('number,title,state')).toEqual({
			number: ISSUE_NUMBER,
			title: ISSUE_TITLE,
			state: 'OPEN',
		})
	})

	// An unknown field produced nothing under `gh --json` either, so it is left out rather than
	// filled in — the schemas downstream carry the defaults.
	it('leaves out a field REST does not carry', () => {
		expect(map('number,somethingElse')).toEqual({ number: ISSUE_NUMBER })
	})
})

describe('parse_rest_issue — a response that is not an issue', () => {
	// Throwing is what the callers turn into `undefined`, which is the same "the read failed" every
	// other failure produces. Degrading to an empty object would report an issue whose every field
	// is missing.
	it('throws on output that is not JSON', () => {
		expect(() => git_gh_issue_rest.parse_rest_issue('not json at all')).toThrow()
	})

	it('throws on JSON that is not an object', () => {
		expect(() => git_gh_issue_rest.parse_rest_issue('[1, 2, 3]')).toThrow()
	})

	// A 200 carrying an API message object rather than an issue would otherwise be read as an issue
	// whose every field is missing, and `git-epic-close` reports that as `is_closed: false` fact.
	it('throws on an object that is not an issue', () => {
		expect(() => git_gh_issue_rest.parse_rest_issue('{"message":"Not Found"}')).toThrow()
	})

	// A pull request carries no dependency summary at all, and the issue endpoint serves one as
	// readily as an issue — `epic:bundle` reads a referenced number before knowing which it is.
	it('accepts an issue that carries no dependency summary', () => {
		expect(git_gh_issue_rest.parse_rest_issue(rest_issue()).number).toBe(ISSUE_NUMBER)
	})
})

describe('empty_blocked_by', () => {
	it('is the connection an issue with no blockers answers with', () => {
		expect(git_gh_issue_rest.empty_blocked_by()).toEqual({ nodes: [], totalCount: 0 })
	})

	it('parses under the schema the epic readers use', () => {
		expect(blocked_by_schema.parse(git_gh_issue_rest.empty_blocked_by())?.nodes).toEqual([])
	})
})

describe('to_blocked_by — the connection gh answered with', () => {
	it('maps the listing into nodes and a total', () => {
		expect(git_gh_issue_rest.to_blocked_by(rest_blockers())).toEqual({
			nodes: [{ number: BLOCKER_NUMBER, state: 'CLOSED' }],
			totalCount: 1,
		})
	})

	it('upper-cases an open blocker too', () => {
		expect(git_gh_issue_rest.to_blocked_by(rest_blockers('open')).nodes).toEqual([
			{ number: BLOCKER_NUMBER, state: 'OPEN' },
		])
	})

	it('answers an empty connection for an issue with no blockers', () => {
		expect(git_gh_issue_rest.to_blocked_by(EMPTY_LISTING)).toEqual({ nodes: [], totalCount: 0 })
	})

	// `nodes` is one page; `totalCount` was exact under GraphQL, and the issue's own dependency
	// summary is what keeps it exact rather than collapsing to the page size.
	it('prefers the exact total the issue reports over the page size', () => {
		const connection = git_gh_issue_rest.to_blocked_by(rest_blockers(), EXACT_BLOCKER_TOTAL)

		expect(connection.totalCount).toBe(EXACT_BLOCKER_TOTAL)
	})

	// The fail-safe direction: an empty `nodes` reads as "this child has no blockers", and
	// `epic:next` would then hand a dependent to an unattended run before its prerequisite.
	it('throws rather than answering no blockers when the listing will not parse', () => {
		expect(() => git_gh_issue_rest.to_blocked_by('{"message":"rate limit"}')).toThrow()
	})

	// `blocking_issue_schema.number` is required on purpose (joshuafolkken/kit#1005), and the mapping
	// inherits that: a shape change stays "this child is unreadable" rather than becoming "this child
	// has no blockers".
	it('throws rather than dropping a blocker whose number is missing', () => {
		expect(() => git_gh_issue_rest.to_blocked_by('[{"state":"open"}]')).toThrow()
	})
})

describe('total_blocked_by', () => {
	it('reads the exact count off the issue', () => {
		const rest = git_gh_issue_rest.parse_rest_issue(
			rest_issue({ issue_dependencies_summary: { total_blocked_by: EXACT_BLOCKER_TOTAL } }),
		)

		expect(git_gh_issue_rest.total_blocked_by(rest)).toBe(EXACT_BLOCKER_TOTAL)
	})

	it('answers undefined when the issue carries no summary', () => {
		const rest = git_gh_issue_rest.parse_rest_issue(rest_issue())

		expect(git_gh_issue_rest.total_blocked_by(rest)).toBeUndefined()
	})
})

describe('to_field_text — one value as --jq printed it', () => {
	it('answers a string bare', () => {
		expect(git_gh_issue_rest.to_field_text(ISSUE_TITLE)).toBe(ISSUE_TITLE)
	})

	it('answers an absent value as the empty answer', () => {
		expect(git_gh_issue_rest.to_field_text(undefined)).toBe('')
	})

	it('answers a null value as the empty answer', () => {
		// eslint-disable-next-line unicorn/no-null -- the value REST actually sends for an empty field
		expect(git_gh_issue_rest.to_field_text(null)).toBe('')
	})

	it('answers anything else as JSON', () => {
		expect(git_gh_issue_rest.to_field_text(ISSUE_NUMBER)).toBe(String(ISSUE_NUMBER))
	})
})

// The schemas are the contract the mapping has to satisfy: they were written against `gh`'s output,
// and nothing downstream was allowed to change (joshuafolkken/kit#1024).
describe('the mapped shape parses under the schemas written for gh', () => {
	const connection = git_gh_issue_rest.to_blocked_by(rest_blockers())
	const mapped = git_gh_issue_rest.to_gh_issue(
		git_gh_issue_rest.parse_rest_issue(rest_issue()),
		git_gh_issue_rest.split_fields('number,state,labels,body,blockedBy'),
		connection,
	)

	it('parses as an epic child', () => {
		expect(epic_child_schema.parse(mapped)).toEqual({
			state: 'OPEN',
			blockedBy: { nodes: [{ number: BLOCKER_NUMBER, state: 'CLOSED' }], totalCount: 1 },
		})
	})

	it('parses as an epic subject', () => {
		expect(epic_subject_schema.parse(mapped).number).toBe(ISSUE_NUMBER)
	})

	it('parses as a blocked-by connection', () => {
		expect(blocked_by_schema.parse(connection)?.totalCount).toBe(1)
	})

	it('parses each node as a blocking issue', () => {
		expect(blocking_issue_schema.parse({ number: BLOCKER_NUMBER, state: 'CLOSED' }).number).toBe(
			BLOCKER_NUMBER,
		)
	})
})

// joshuafolkken/kit#1126: a `blocked-by` relation may cross a repository, and the number alone cannot
// say which one it names. REST puts the repository in `repository_url`.
describe('repo_of_url', () => {
	it('reads the owner and repository out of a REST repository url', () => {
		expect(git_gh_issue_rest.repo_of_url('https://api.github.com/repos/joshuafolkken/kit')).toBe(
			'joshuafolkken/kit',
		)
	})

	it('answers nothing for an absent field, so the caller falls back to its own repository', () => {
		expect(git_gh_issue_rest.repo_of_url(undefined)).toBeUndefined()
	})

	it('answers nothing for a url that is not a repository', () => {
		expect(git_gh_issue_rest.repo_of_url('https://api.github.com/user')).toBeUndefined()
	})
})
