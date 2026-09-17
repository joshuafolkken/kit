import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./git-worktree', () => ({
	git_worktree: { ls_remote_branch: vi.fn() },
}))

const { git_worktree } = await import('./git-worktree')
const { git_remote_branch } = await import('./git-remote-branch')

const ls_remote_branch = vi.mocked(git_worktree.ls_remote_branch)

const BRANCH = 'release/v1.2.0'
const HEAD_LINE = `0123456789abcdef0123456789abcdef01234567\trefs/heads/${BRANCH}`
const OFFLINE_MESSAGE = 'ssh: connect to host github.com port 22: Network is unreachable'

beforeEach(() => {
	vi.clearAllMocks()
	ls_remote_branch.mockResolvedValue('')
})

describe('git_remote_branch.ask', () => {
	it('answers present when ls-remote prints a matching head', async () => {
		ls_remote_branch.mockResolvedValue(HEAD_LINE)

		expect(await git_remote_branch.ask(BRANCH)).toBe('present')
	})

	it('answers absent when ls-remote prints nothing', async () => {
		expect(await git_remote_branch.ask(BRANCH)).toBe('absent')
	})

	// Whitespace-only output is the same zero-exit "nothing matched" as an empty string, so it must
	// not read as a head.
	it('answers absent for whitespace-only output', async () => {
		ls_remote_branch.mockResolvedValue('\n  \n')

		expect(await git_remote_branch.ask(BRANCH)).toBe('absent')
	})

	// The distinction the whole module exists for: a transport failure must never be folded into
	// `absent`, because both callers act on the two answers differently and both would act wrongly on
	// a silent "not there".
	it('answers unreachable when ls-remote fails rather than reporting absent', async () => {
		ls_remote_branch.mockRejectedValue(new Error(OFFLINE_MESSAGE))

		expect(await git_remote_branch.ask(BRANCH)).toBe('unreachable')
	})

	// The defect this replaced passed a pattern to `git branch --list --remotes`, whose short names
	// carry the remote — so what crosses this boundary is the bare branch name, never `origin/<name>`.
	// **It is not the ref namespace**: `ls_remote_branch` anchors the query at `refs/heads/` on the
	// far side (joshuafolkken/kit#1709), and this layer neither adds that prefix nor knows about it.
	it('hands the remote read the bare branch name, without an origin/ prefix', async () => {
		await git_remote_branch.ask(BRANCH)

		expect(ls_remote_branch).toHaveBeenCalledWith(BRANCH)
	})
})
