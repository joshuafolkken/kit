import { issue_watch_diff } from '#scripts/issue/issue-watch-diff'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_write } from './git-gh-issue-write'

// The two stamps a posted comment carries. Kept apart from `git-gh-issue-write.test.ts`, which is at
// the 300 lines a file may hold. A run's own comment carries the run marker; a person's instruction a
// session relays carries the user marker instead, so the run holding the issue reads it as an update.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const ISSUE_NUMBER = '9099'
const ISSUES_PATH = 'repos/{owner}/{repo}/issues'
const COMMENTS_PATH = `${ISSUES_PATH}/${ISSUE_NUMBER}/comments`
const COMMENT_URL = `https://github.com/joshuafolkken/kit/issues/${ISSUE_NUMBER}#issuecomment-1`
const BODY = '## Addition\n\n- also cover X\n'

beforeEach(() => {
	mocked_api.mockReset().mockResolvedValue(COMMENT_URL)
})

function posted_body(): string {
	const posted: unknown = JSON.parse(mocked_api.mock.calls[0]?.[0].body ?? '{}')

	return JSON.stringify(posted)
}

describe('issue_user_comment', () => {
	it('stamps the user marker and not the run marker', async () => {
		const url = await git_gh_issue_write.issue_user_comment(ISSUE_NUMBER, BODY)

		expect(url).toBe(COMMENT_URL)
		expect(mocked_api.mock.calls[0]?.[0].path).toBe(COMMENTS_PATH)
		expect(posted_body()).toBe(
			JSON.stringify({ body: `${BODY}\n\n${issue_watch_diff.USER_MARKER}` }),
		)
		expect(posted_body()).not.toContain(issue_watch_diff.RUN_MARKER)
	})
})

describe('issue_comment', () => {
	it('stamps the run marker and not the user marker, as before', async () => {
		await git_gh_issue_write.issue_comment(ISSUE_NUMBER, BODY)

		expect(posted_body()).toBe(
			JSON.stringify({ body: `${BODY}\n\n${issue_watch_diff.RUN_MARKER}` }),
		)
		expect(posted_body()).not.toContain(issue_watch_diff.USER_MARKER)
	})
})
