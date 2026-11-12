import { epic_bundle_cli } from '#scripts/epic/epic-bundle-cli'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import {
	BLOCKED_BY_SEGMENT,
	rest_dependencies_summary,
	rest_issue,
	rest_issue_page,
} from '#scripts/gh/git-gh-issue-rest-fixture'
import { GRAPHQL_PATH } from '#scripts/gh/git-gh-pr-graphql-state'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#scripts/gh/git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

// The page reads go through `exec_gh_api` here, as in `git-gh-issue-list-relations.test.ts`.
vi.mock('#scripts/gh/git-gh-etag-read', async () => {
	const { git_gh_etag_read_fixture } = await import('#scripts/gh/git-gh-etag-read-fixture')

	return { git_gh_etag_read: git_gh_etag_read_fixture.through_exec }
})

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

// joshuafolkken/kit#6796: `issue:file` spends 10 REST calls before the create and 2 on it, so the
// placement after it has 8 to stay within 20. Before the fix it re-read the backlog until the new
// issue was listed, at two calls per open issue declaring a blocker — about 72 per read at 35 such
// issues. The backlog here is larger than that on purpose: the budget must not grow with it.
const REPO = 'joshuafolkken/kit'
const SUBJECT = 9000
const FIRST_ISSUE = 1
const OPEN_ISSUES = 150
const EPICS = 20
const FIRST_EPIC = 5000
const PLACEMENT_BUDGET = 8
const FIRST_PAGE = '&page=1'
const SECOND_PAGE_START = 100
const BLOCKER = 1

function open_rows(): Array<Record<string, unknown>> {
	return Array.from({ length: OPEN_ISSUES }, (_, index) => ({
		number: FIRST_ISSUE + index,
		node_id: `I_${String(FIRST_ISSUE + index)}`,
		body: `follows #${String(BLOCKER)}`,
		...rest_dependencies_summary(1),
	}))
}

function epic_rows(): Array<Record<string, unknown>> {
	return Array.from({ length: EPICS }, (_, index) => ({
		number: FIRST_EPIC + index,
		body: `- [ ] #${String(FIRST_ISSUE + index)}\n- [ ] #${String(FIRST_ISSUE + EPICS + index)}`,
		labels: [{ name: 'epic' }],
	}))
}

function graphql_answer(body = '{}'): string {
	const { variables } = JSON.parse(body) as { variables: { ids: Array<string> } }
	const blocker = { number: BLOCKER, state: 'OPEN', repository: { nameWithOwner: REPO } }
	const blocked_by = { nodes: [blocker] }

	return JSON.stringify({
		data: { nodes: variables.ids.map((id) => ({ id, blockedBy: blocked_by })) },
	})
}

function listing_page(path: string): string {
	if (path.includes('labels=epic')) return rest_issue_page(epic_rows())
	const rows = open_rows()

	return rest_issue_page(
		path.endsWith(FIRST_PAGE) ? rows.slice(0, SECOND_PAGE_START) : rows.slice(SECOND_PAGE_START),
	)
}

// The subject is absent from the listing — the trailing listing a just-filed issue meets.
function serve(): void {
	mocked_api.mockImplementation(async (request) => {
		if (request.path === GRAPHQL_PATH) return graphql_answer(request.body)
		if (request.path.includes(BLOCKED_BY_SEGMENT)) return '[]'

		if (request.path.includes(`/issues/${String(SUBJECT)}`)) {
			return rest_issue({ number: SUBJECT, ...rest_dependencies_summary(0) })
		}

		return await listing_page(request.path)
	})
}

describe('issue:file — the placement call budget', () => {
	beforeEach(() => {
		mocked_api.mockReset()
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
	})

	it('places a just-filed issue within the placement budget', async () => {
		serve()

		expect(await epic_bundle_cli.report_for(SUBJECT, REPO)).toBe(0)
		expect(mocked_api.mock.calls.length).toBeLessThanOrEqual(PLACEMENT_BUDGET)
	})

	it('makes no per-issue relation read for the open backlog', async () => {
		serve()
		await epic_bundle_cli.report_for(SUBJECT, REPO)

		const relation_reads = mocked_api.mock.calls.filter(([request]) =>
			request.path.includes(BLOCKED_BY_SEGMENT),
		)

		expect(relation_reads.length).toBeLessThanOrEqual(1)
	})
})
