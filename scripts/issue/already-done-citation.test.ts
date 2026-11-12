import { beforeEach, describe, expect, it, vi } from 'vitest'
import { already_done_citation } from './already-done-citation'

// joshuafolkken/kit#7093: the issue closes only on a cited pull request GitHub answers as merged. The
// REST read is mocked per path, so each answer — merged, open, closed unmerged, missing — is set.
// joshuafolkken/kit#7101: or on a cited commit `origin/main` contains, the git read mocked per SHA.

const { exec_gh_api, read } = vi.hoisted(() => ({
	exec_gh_api: vi.fn<(request: { path: string }) => Promise<string>>(),
	read: vi.fn<(arguments_: Array<string>) => Promise<string>>(),
}))

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api } }))
vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read } }))

const ON_MAIN = 'on main'
const COMMIT_ONLY = 'commit 1a2b3c4d'
const PULL_AND_COMMIT = 'PR #4000, then 1a2b3c4d'
const NOT_ANCESTOR_EXIT_CODE = 1
const UNKNOWN_OBJECT_EXIT_CODE = 128

function git_failure(exit_code: number, message: string): Error {
	return Object.assign(new Error(message), { exitCode: exit_code })
}

// Each SHA answers as on main, or with the failure git raises for it.
function ancestry(commits: Record<string, Error | typeof ON_MAIN>): void {
	read.mockImplementation(async (arguments_) => {
		const outcome = commits[arguments_[2] ?? '']
		if (outcome === undefined) throw new Error(`unexpected git ${arguments_.join(' ')}`)
		if (outcome !== ON_MAIN) throw outcome

		return ''
	})
}

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
	read.mockReset()
})

describe('already_done_citation.close_refusal — a commit on origin/main closes', () => {
	it('admits a cited SHA origin/main contains, asking git whether it is an ancestor', async () => {
		ancestry({ '1a2b3c4d': ON_MAIN })

		expect(await already_done_citation.close_refusal('landed in commit 1a2b3c4d')).toBeUndefined()
		expect(read).toHaveBeenCalledWith(['merge-base', '--is-ancestor', '1a2b3c4d', 'origin/main'])
	})

	it('admits a SHA on main beside an unmerged pull request', async () => {
		answer({ 'repos/{owner}/{repo}/pulls/4000': OPEN })
		ancestry({ '1a2b3c4d': ON_MAIN })

		expect(await already_done_citation.close_refusal(PULL_AND_COMMIT)).toBeUndefined()
	})

	it('reads a SHA cited twice once', async () => {
		ancestry({ '1a2b3c4d': ON_MAIN })

		await already_done_citation.close_refusal('1a2b3c4d and again 1a2b3c4d')

		expect(read).toHaveBeenCalledOnce()
	})
})

describe('already_done_citation.close_refusal — a commit that does not check', () => {
	it('refuses a SHA origin/main does not contain', async () => {
		ancestry({ '1a2b3c4d': git_failure(NOT_ANCESTOR_EXIT_CODE, 'exit 1') })

		expect(await already_done_citation.close_refusal(COMMIT_ONLY)).toBe(
			'1a2b3c4d is not on origin/main',
		)
	})

	it('refuses a SHA git does not know with the read failure', async () => {
		const unknown = git_failure(UNKNOWN_OBJECT_EXIT_CODE, 'fatal: Not a valid object name')

		ancestry({ '1a2b3c4d': unknown })

		expect(await already_done_citation.close_refusal(COMMIT_ONLY)).toBe(
			'1a2b3c4d not read: fatal: Not a valid object name',
		)
	})

	it('refuses a git read that fails without an exit code', async () => {
		ancestry({ '1a2b3c4d': new Error('spawn git ENOENT') })

		expect(await already_done_citation.close_refusal(COMMIT_ONLY)).toBe(
			'1a2b3c4d not read: spawn git ENOENT',
		)
	})

	it('joins the reasons of every citation that does not check', async () => {
		answer({ 'repos/{owner}/{repo}/pulls/4000': OPEN })
		ancestry({ '1a2b3c4d': git_failure(NOT_ANCESTOR_EXIT_CODE, 'exit 1') })

		expect(await already_done_citation.close_refusal(PULL_AND_COMMIT)).toBe(
			'#4000 is not merged; 1a2b3c4d is not on origin/main',
		)
	})
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

	it.each(['see #4000', 'scripts/a.ts:12', 'build 12345678', 'commit deadbeef'])(
		'refuses %s without reading GitHub or git',
		async (evidence) => {
			expect(await already_done_citation.close_refusal(evidence)).toBe(
				'the evidence cites no pull request or commit',
			)
			expect(exec_gh_api).not.toHaveBeenCalled()
			expect(read).not.toHaveBeenCalled()
		},
	)

	it('reads a pull request cited twice once', async () => {
		answer({ 'repos/{owner}/{repo}/pulls/4000': OPEN })

		await already_done_citation.close_refusal('PR #4000, merged in #4000')

		expect(exec_gh_api).toHaveBeenCalledOnce()
	})
})
