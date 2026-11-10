import { beforeEach, describe, expect, it, vi } from 'vitest'
import { already_done_citation } from './already-done-citation'

// joshuafolkken/kit#7093: the issue closes only on a cited pull request GitHub answers as merged. The
// REST read is mocked per path, so each answer — merged, open, closed unmerged, missing — is set.

const { exec_gh_api } = vi.hoisted(() => ({
	exec_gh_api: vi.fn<(request: { path: string }) => Promise<string>>(),
}))

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api } }))

const MERGED = JSON.stringify({ number: 1, state: 'closed', merged: true })
const OPEN = JSON.stringify({ number: 1, state: 'open', merged: false })
const CLOSED_UNMERGED = JSON.stringify({ number: 1, state: 'closed', merged: false })

function answer(pulls: Record<string, string>): void {
	exec_gh_api.mockImplementation(async ({ path }) => {
		const json = pulls[path]
		if (json === undefined) throw new Error('HTTP 404: Not Found')

		return json
	})
}

beforeEach(() => {
	exec_gh_api.mockReset()
})

describe('already_done_citation.close_refusal — a merged pull request closes', () => {
	it.each(['PR #4000 carries it', 'pull request #4000', 'merged in #4000', '/pull/4000'])(
		'admits %s',
		async (evidence) => {
			answer({ 'repos/{owner}/{repo}/pulls/4000': MERGED })

			expect(await already_done_citation.close_refusal(evidence)).toBeUndefined()
		},
	)

	it('reads a link to another repository there', async () => {
		answer({ 'repos/other/repo/pulls/12': MERGED })

		expect(
			await already_done_citation.close_refusal('https://github.com/other/repo/pull/12'),
		).toBeUndefined()
	})

	it('admits evidence where one of several cited pull requests is merged', async () => {
		answer({ 'repos/{owner}/{repo}/pulls/2': MERGED, 'repos/{owner}/{repo}/pulls/1': OPEN })

		expect(await already_done_citation.close_refusal('PR #1 then PR #2')).toBeUndefined()
	})
})

describe('already_done_citation.close_refusal — what does not check', () => {
	it.each([
		['open', OPEN],
		['closed unmerged', CLOSED_UNMERGED],
	])('refuses a cited pull request that is %s', async (_case, json) => {
		answer({ 'repos/{owner}/{repo}/pulls/4000': json })

		expect(await already_done_citation.close_refusal('PR #4000')).toBe('#4000 is not merged')
	})

	it('refuses a missing pull request with the read failure', async () => {
		answer({})

		expect(await already_done_citation.close_refusal('PR #4000')).toBe(
			'#4000 not read: HTTP 404: Not Found',
		)
	})

	it('refuses a read that answers no pull request', async () => {
		answer({ 'repos/{owner}/{repo}/pulls/4000': '{"message":"Bad credentials"}' })

		expect(await already_done_citation.close_refusal('PR #4000')).toMatch(/^#4000 not read: /u)
	})

	it.each(['commit 1a2b3c4d', 'see #4000', 'scripts/a.ts:12'])(
		'refuses %s without reading GitHub',
		async (evidence) => {
			expect(await already_done_citation.close_refusal(evidence)).toBe(
				'the evidence cites no pull request',
			)
			expect(exec_gh_api).not.toHaveBeenCalled()
		},
	)

	it('reads a pull request cited twice once', async () => {
		answer({ 'repos/{owner}/{repo}/pulls/4000': OPEN })

		await already_done_citation.close_refusal('PR #4000, merged in #4000')

		expect(exec_gh_api).toHaveBeenCalledOnce()
	})
})
