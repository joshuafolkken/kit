import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'

// joshuafolkken/kit#3773: the issue watch polls with `If-None-Match`, and `gh` reports a 304 by
// exiting non-zero. The status has to be read off the failure's `--include` stdout, so a 304 is
// "unchanged" while every other failure stays "unreadable".

const PATH = 'repos/o/r/issues/3773'
const ETAG = 'W/"abc"'
const NEW_ETAG = 'W/"def"'
const BODY = '{"state":"open"}'
const TIMEOUT_MS = 5000
const UNREADABLE: ConditionalRead = { kind: 'unreadable' }

function mocked_command(): MockInstance<typeof git_gh_exec.exec_gh_command> {
	return vi.spyOn(git_gh_exec, 'exec_gh_command')
}

function failure_with_stdout(stdout: string): Error {
	return new Error('gh: HTTP failure', { cause: Object.assign(new Error('exit 1'), { stdout }) })
}

async function read(): Promise<ConditionalRead> {
	return await git_gh_conditional.read_conditional(PATH, ETAG)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('git_gh_conditional.to_args', () => {
	it('sends If-None-Match only when an etag is given', () => {
		expect(git_gh_conditional.to_args(PATH, ETAG)).toStrictEqual([
			'api',
			'--include',
			'-H',
			`If-None-Match: ${ETAG}`,
			PATH,
		])
		expect(git_gh_conditional.to_args(PATH, undefined)).toStrictEqual(['api', '--include', PATH])
	})
})

describe('git_gh_conditional.read_conditional — a 200', () => {
	it('answers changed with the etag and the body', async () => {
		const command = mocked_command().mockResolvedValueOnce(
			`HTTP/2.0 200 OK\r\nETag: ${NEW_ETAG}\r\n\r\n${BODY}`,
		)
		const answer = await git_gh_conditional.read_conditional(PATH, ETAG, TIMEOUT_MS)

		expect(answer).toStrictEqual({ kind: 'changed', etag: NEW_ETAG, body: BODY })
		expect(command).toHaveBeenCalledWith(git_gh_conditional.to_args(PATH, ETAG), TIMEOUT_MS)
	})

	it('answers changed without an etag when the header is missing', async () => {
		mocked_command().mockResolvedValueOnce(`HTTP/2.0 200 OK\n\n${BODY}`)

		await expect(git_gh_conditional.read_conditional(PATH, undefined)).resolves.toStrictEqual({
			kind: 'changed',
			etag: undefined,
			body: BODY,
		})
	})
})

describe('git_gh_conditional.read_conditional — everything else', () => {
	it('answers unchanged on a 304 carried by the failure', async () => {
		mocked_command().mockRejectedValueOnce(failure_with_stdout('HTTP/2.0 304 Not Modified\n\n'))

		await expect(read()).resolves.toStrictEqual({ kind: 'unchanged' })
	})

	it('answers unreadable on any other failure', async () => {
		mocked_command()
			.mockRejectedValueOnce(failure_with_stdout('HTTP/2.0 403 Forbidden\n\n{}'))
			.mockRejectedValueOnce(new Error('network down'))

		await expect(read()).resolves.toStrictEqual(UNREADABLE)
		await expect(read()).resolves.toStrictEqual(UNREADABLE)
	})

	it('answers unreadable on a non-200 success', async () => {
		mocked_command().mockResolvedValueOnce(`HTTP/2.0 202 Accepted\n\n${BODY}`)

		await expect(read()).resolves.toStrictEqual(UNREADABLE)
	})
})
