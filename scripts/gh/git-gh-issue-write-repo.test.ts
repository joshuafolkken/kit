import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'
import { git_gh_issue_write } from './git-gh-issue-write'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

// joshuafolkken/kit#4134: `josh issue:plan --repo` addresses the title, the body and the comment to
// another repository's issue, so each write's path names that repository, not gh's placeholder.
const ISSUE_NUMBER = '7'
const OTHER_REPO = 'joshuafolkken/app-kit'
const OTHER_ISSUE_PATH = `repos/${OTHER_REPO}/issues/${ISSUE_NUMBER}`
const ISSUE_URL = `https://github.com/${OTHER_REPO}/issues/${ISSUE_NUMBER}`
const BODY = '## Plan\n- step one\n'
const TITLE = 'A clearer title'

function first_request(): GhApiRequest {
	const [call] = mocked_api.mock.calls
	if (call === undefined) throw new Error('gh api was not called')

	return call[0]
}

beforeEach(() => {
	vi.clearAllMocks()
	mocked_api.mockResolvedValue(ISSUE_URL)
})

describe('issue writes — naming another repository', () => {
	it('patches the body of that repository issue', async () => {
		await git_gh_issue_write.issue_edit_body(ISSUE_NUMBER, BODY, OTHER_REPO)

		expect(first_request()).toMatchObject({ path: OTHER_ISSUE_PATH, method: 'PATCH' })
	})

	it('patches the title of that repository issue', async () => {
		await git_gh_issue_write.issue_edit_title(ISSUE_NUMBER, TITLE, OTHER_REPO)

		expect(first_request()).toMatchObject({ path: OTHER_ISSUE_PATH, method: 'PATCH' })
	})

	it('posts the comment to that repository issue', async () => {
		await git_gh_issue_write.issue_comment(ISSUE_NUMBER, BODY, OTHER_REPO)

		expect(first_request().path).toBe(`${OTHER_ISSUE_PATH}/comments`)
	})

	// joshuafolkken/kit#4821: the deferral note `issue:file` posts names the finder's repository, so it
	// lands there even while `GH_REPO` points the filing's listings at another target.
	it('posts the counted comment to that repository issue', async () => {
		await git_gh_issue_write.issue_try_comment(ISSUE_NUMBER, BODY, OTHER_REPO)

		expect(first_request().path).toBe(`${OTHER_ISSUE_PATH}/comments`)
	})

	// joshuafolkken/kit#4717: a 502 can follow an issue GitHub already opened, so a retried creation
	// could open a second one.
	it('creates that repository issue without the transient-error retry', () => {
		const request = git_gh_issue_write.issue_create_request({
			title: TITLE,
			body: BODY,
			repo: OTHER_REPO,
		})

		expect(request.should_retry).toBe(false)
	})
})
