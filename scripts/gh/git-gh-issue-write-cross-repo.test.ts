import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_write } from './git-gh-issue-write'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

// joshuafolkken/kit#7695: an upstream interrupt's blocker lives in another repository, so its database
// id is read there while the relation is written on the finder in its own repository — named, since the
// filing points `GH_REPO` at the upstream target.
const ISSUE_NUMBER = '320'
const BLOCKER_NUMBER = '7691'
const BLOCKER_ID = 4_100_200_300
const UPSTREAM = 'joshuafolkken/kit'
const FINDER_REPO = 'joshuafolkken/app-kit'
const BLOCKER_PATH = `repos/${UPSTREAM}/issues/${BLOCKER_NUMBER}`
const BLOCKED_BY_PATH = `repos/${FINDER_REPO}/issues/${ISSUE_NUMBER}/dependencies/blocked_by`
const THIS_REPO_PATH = 'repos/{owner}/{repo}/issues/320/dependencies/blocked_by'

beforeEach(() => {
	mocked_api.mockReset()
	mocked_api.mockResolvedValueOnce(String(BLOCKER_ID)).mockResolvedValueOnce('')
})

function requests(): Array<{ path: string; body?: string; method?: string } | undefined> {
	return mocked_api.mock.calls.map(([request]) => request)
}

describe('issue_add_blocked_by — a blocker in another repository', () => {
	it('resolves the blocker in its repository and writes the relation on the finder', async () => {
		expect(
			await git_gh_issue_write.issue_add_blocked_by(
				ISSUE_NUMBER,
				BLOCKER_NUMBER,
				UPSTREAM,
				FINDER_REPO,
			),
		).toBe(true)

		const [resolve, write] = requests()

		expect(resolve?.path).toBe(BLOCKER_PATH)
		expect(write?.path).toBe(BLOCKED_BY_PATH)
		expect(JSON.parse(write?.body ?? '{}')).toStrictEqual({ issue_id: BLOCKER_ID })
	})
})

// `backlog:triage --unblock owner/repo#N` removes the relation an upstream interrupt recorded.
describe('issue_remove_blocked_by — a blocker in another repository', () => {
	it('resolves the blocker in its repository and deletes that relation', async () => {
		expect(
			await git_gh_issue_write.issue_remove_blocked_by(ISSUE_NUMBER, BLOCKER_NUMBER, UPSTREAM),
		).toBe(true)

		const [resolve, remove] = requests()

		expect(resolve?.path).toBe(BLOCKER_PATH)
		expect(remove?.path).toBe(`${THIS_REPO_PATH}/${String(BLOCKER_ID)}`)
	})
})
