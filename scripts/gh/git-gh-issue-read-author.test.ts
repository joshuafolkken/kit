import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_read } from './git-gh-issue-read'
import { BLOCKED_BY_SEGMENT, ISSUE_NUMBER, rest_issue } from './git-gh-issue-rest-fixture'

// joshuafolkken/kit#4633: `backlog:next` offers an epic child only when its author has write access,
// so the read every epic child goes through answers who filed it beside its state.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn(), exec_gh_api_status: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const NO_BLOCKERS = '[]'

beforeEach(() => {
	vi.clearAllMocks()
})

describe('issue_get_state_and_relations_classified — who filed the issue', () => {
	it('answers the author fields beside the state', async () => {
		const issue = rest_issue({ author_association: 'NONE', user: { login: 'outsider' } })

		mocked_api.mockImplementation(async (request) =>
			request.path.includes(BLOCKED_BY_SEGMENT) ? NO_BLOCKERS : issue,
		)

		const read = await git_gh_issue_read.issue_get_state_and_relations_classified(
			String(ISSUE_NUMBER),
		)

		expect(read.kind === 'read' ? read.json : '').toContain(
			'"author_association":"NONE","user":{"login":"outsider"}',
		)
	})
})
