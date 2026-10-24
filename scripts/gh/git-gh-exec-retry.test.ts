import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { gh_retry } from './git-gh-retry'

vi.mock('execa', () => ({
	execa: vi.fn(),
	execaSync: vi.fn(),
}))

vi.mock('./git-gh-check', () => ({
	check_gh_installed: vi.fn(),
	GH_NOT_INSTALLED_MSG: 'gh CLI is not installed. Install it from https://cli.github.com/',
}))

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }))

// joshuafolkken/kit#4717: every REST request through `exec_gh_api` — `review:record --comment` and
// the pull-request writes `josh ship` makes — survives a transient 502 instead of stopping the stage.

const mocked_execa = vi.mocked(execa)
const API_PATH = 'repos/o/r/issues/1/comments'
const BAD_GATEWAY = 'gh: Server Error (HTTP 502)'
const POSTED = '{"id":1}'

type ExecaResult = Awaited<ReturnType<typeof execa>>

function fake_stdout_result(stdout: string): ExecaResult {
	const result = { stdout }

	return result as unknown as ExecaResult
}

function reject_bad_gateway(): void {
	mocked_execa.mockRejectedValueOnce(
		Object.assign(new Error('failed'), { stderr: `${BAD_GATEWAY}\n`, stdout: '' }),
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

describe('exec_gh_api — a transient GitHub failure', () => {
	it('posts on the retry after a 502 and writes one log line', async () => {
		reject_bad_gateway()
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(POSTED))

		await expect(
			git_gh_exec.exec_gh_api({ path: API_PATH, method: 'POST', body: '{"body":"x"}' }),
		).resolves.toBe(POSTED)
		expect(mocked_execa).toHaveBeenCalledTimes(2)
		expect(process.stderr.write).toHaveBeenCalledTimes(1)
		expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining(BAD_GATEWAY))
	})

	it('throws the 502 once every attempt failed', async () => {
		for (let attempt = 0; attempt < gh_retry.MAX_ATTEMPTS; attempt += 1) reject_bad_gateway()

		await expect(git_gh_exec.exec_gh_api({ path: API_PATH })).rejects.toThrow(BAD_GATEWAY)
		expect(mocked_execa).toHaveBeenCalledTimes(gh_retry.MAX_ATTEMPTS)
	})

	// An issue creation that 502s may already have opened the issue; asking again would open a second.
	it('sends a request that opts out of retrying only once', async () => {
		reject_bad_gateway()

		await expect(
			git_gh_exec.exec_gh_api({ path: API_PATH, body: '{"title":"x"}', should_retry: false }),
		).rejects.toThrow(BAD_GATEWAY)
		expect(mocked_execa).toHaveBeenCalledTimes(1)
		expect(process.stderr.write).not.toHaveBeenCalled()
	})
})
