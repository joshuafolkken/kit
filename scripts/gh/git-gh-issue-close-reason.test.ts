import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_write } from './git-gh-issue-write'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const ISSUE_NUMBER = '6567'
const ISSUES_PATH = 'repos/{owner}/{repo}/issues'
const ISSUE_PATH = `${ISSUES_PATH}/${ISSUE_NUMBER}`

function close_body(): unknown {
	const request = mocked_api.mock.calls.at(-1)?.[0]

	expect(request).toMatchObject({ path: ISSUE_PATH, method: 'PATCH' })

	return JSON.parse(request?.body ?? '')
}

beforeEach(() => {
	mocked_api.mockReset()
	mocked_api.mockResolvedValue('')
})

describe('issue_close reason', () => {
	it('writes the state_reason it is given beside the closed state', async () => {
		expect(await git_gh_issue_write.issue_close(ISSUE_NUMBER, undefined, 'not_planned')).toBe(true)
		expect(close_body()).toStrictEqual({ state: 'closed', state_reason: 'not_planned' })
	})

	it('writes no state_reason when none is given', async () => {
		expect(await git_gh_issue_write.issue_close(ISSUE_NUMBER, undefined)).toBe(true)
		expect(close_body()).toStrictEqual({ state: 'closed' })
	})
})
