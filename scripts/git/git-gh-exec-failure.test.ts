import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'

vi.mock('execa', () => ({
	execa: vi.fn(),
	execaSync: vi.fn(),
}))

vi.mock('./git-gh-check', () => ({
	check_gh_installed: vi.fn(),
	GH_NOT_INSTALLED_MSG: 'gh CLI is not installed. Install it from https://cli.github.com/',
}))

const mocked_execa = vi.mocked(execa)

// joshuafolkken/kit#1690: the same stdout that carries the diagnosis carries the status GitHub
// answered with, so the failed request describes itself and no second one has to be spent asking.
const PR_VIEW_ARGS = ['pr', 'view']
const GH_FAILED = 'failed'
const NOT_FOUND_STATUS = 404
const NOT_FOUND_STDERR = 'gh: Not Found'
const NOT_FOUND_BODY = '{"message":"Not Found","status":"404"}'
const CONNECTION_STDERR = 'error connecting to api.github.com'

beforeEach(() => {
	vi.clearAllMocks()
})

function reject_with(stderr: string, stdout: string): void {
	mocked_execa.mockRejectedValueOnce(Object.assign(new Error(GH_FAILED), { stderr, stdout }))
}

async function thrown_by_gh(): Promise<unknown> {
	try {
		await git_gh_exec.exec_gh_command(PR_VIEW_ARGS)
	} catch (error_) {
		return error_
	}

	return undefined
}

describe('to_gh_error — the failure nature it attaches', () => {
	it('carries the status GitHub wrote in its own error document', async () => {
		reject_with(`${NOT_FOUND_STDERR}\n`, `${NOT_FOUND_BODY}\n`)

		expect(gh_failure.failure_of(await thrown_by_gh())).toEqual({ status: NOT_FOUND_STATUS })
	})

	// A request that never arrived wrote no response body, so there is no status to report — which is
	// exactly what the transport case has to look like.
	it('carries no status when nothing answered the request', async () => {
		reject_with(CONNECTION_STDERR, '')

		expect(gh_failure.failure_of(await thrown_by_gh())).toEqual({ status: undefined })
	})

	// The annotation must not change what an equality check, a log or a serializer sees.
	it('leaves the message it already built untouched', async () => {
		reject_with(`${NOT_FOUND_STDERR}\n`, '')

		await expect(git_gh_exec.exec_gh_command(PR_VIEW_ARGS)).rejects.toThrow(
			new Error(NOT_FOUND_STDERR),
		)
	})
})
