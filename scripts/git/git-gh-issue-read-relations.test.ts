import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'
import { git_gh_issue_read } from './git-gh-issue-read'
import { BLOCKED_BY_SEGMENT, ISSUE_NUMBER, rest_issue } from './git-gh-issue-rest-fixture'

// joshuafolkken/kit#1690: one read makes two requests, and only the first resolves the number. The
// relations endpoint is reached after the issue itself came back, so its own 404 — the endpoint
// absent on an older host, which `has_no_relations_endpoint` handles for the other entry point —
// must never report an issue that exists as missing.
//
// Its own file rather than another describe in `git-gh-issue-read.test.ts`, which is at its
// file-length limit; the mock setup is repeated the way `git-gh-exec-timeout.test.ts` repeats it.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn(), exec_gh_api_status: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const READ_NUMBER = String(ISSUE_NUMBER)
const NOT_FOUND_STATUS = 404

beforeEach(() => {
	vi.clearAllMocks()
})

// The issue itself answers; the relations request behind it does not.
function reject_relations(status: number | undefined): void {
	const error = gh_failure.attach(new Error('gh: some wording or other'), { status })

	mocked_api.mockImplementation(async (request) => {
		await Promise.resolve()
		if (request.path.includes(BLOCKED_BY_SEGMENT)) throw error

		return rest_issue()
	})
}

describe('issue_view_json_classified — which of the two requests failed', () => {
	it('does not report the issue as missing when the relations endpoint answered 404', async () => {
		reject_relations(NOT_FOUND_STATUS)

		await expect(
			git_gh_issue_read.issue_view_json_classified(READ_NUMBER, 'blockedBy'),
		).resolves.toEqual({ kind: 'unreadable', reason: 'rejected', status: NOT_FOUND_STATUS })
	})

	// The rest of the classification is untouched: a follow-up request that never reached GitHub is
	// still the transport case, and still worth asking about again.
	it('still reports a relations read that reached no status as unreachable', async () => {
		reject_relations(undefined)

		await expect(
			git_gh_issue_read.issue_view_json_classified(READ_NUMBER, 'blockedBy'),
		).resolves.toEqual({ kind: 'unreadable', reason: 'unreachable', status: undefined })
	})
})
