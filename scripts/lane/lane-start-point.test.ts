import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1535: git is mocked here because the assertions are about which ref this module
// hands `worktree add` and what it does when the fetch fails — `lane-open-start-point.test.ts` is
// the suite that proves the chosen ref actually carries the newer commit, against real git.

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		branch_names_remote: vi.fn(),
		fetch_branch: vi.fn(),
		get_default_branch: vi.fn(),
	},
}))

const { git_command } = await import('#scripts/git/git-command')
const { lane_start_point } = await import('./lane-start-point')

const MAIN = 'main'
const ORIGIN_MAIN = 'origin/main'
const MAIN_TRACKING_REF = 'refs/remotes/origin/main'
const DEVELOP = 'develop'

const default_branch = vi.mocked(git_command.get_default_branch)
const fetch_branch = vi.mocked(git_command.fetch_branch)
const branch_names_remote = vi.mocked(git_command.branch_names_remote)

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	default_branch.mockResolvedValue(MAIN)
	fetch_branch.mockResolvedValue('')
	branch_names_remote.mockResolvedValue([ORIGIN_MAIN])
})

describe('resolving a lane start point', () => {
	it('names the remote-tracking ref in full, never the bare branch name', async () => {
		expect(await lane_start_point.resolve()).toBe(MAIN_TRACKING_REF)
	})

	it('refreshes the remote-tracking ref before reading it', async () => {
		await lane_start_point.resolve()

		expect(fetch_branch).toHaveBeenCalledWith(MAIN)
	})

	it('follows the repository default branch rather than assuming main', async () => {
		default_branch.mockResolvedValue(DEVELOP)
		branch_names_remote.mockResolvedValue([`origin/${DEVELOP}`])

		expect(await lane_start_point.resolve()).toBe(`refs/remotes/origin/${DEVELOP}`)
		expect(branch_names_remote).toHaveBeenCalledWith(`origin/${DEVELOP}`)
	})
})

describe('degrading when the remote is out of reach', () => {
	// The lane still has to open with no network at all; what it loses is the refresh, not the ref.
	it('opens from the remote-tracking ref as it stands when the fetch fails', async () => {
		fetch_branch.mockRejectedValue(new Error('ssh: connect to host github.com port 22'))

		expect(await lane_start_point.resolve()).toBe(MAIN_TRACKING_REF)
	})

	it('says on stderr that the fetch did not happen', async () => {
		fetch_branch.mockRejectedValue(new Error('offline'))

		await lane_start_point.resolve()

		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(ORIGIN_MAIN))
	})

	it('falls back to the local branch where there is no remote-tracking ref at all', async () => {
		branch_names_remote.mockResolvedValue([])

		expect(await lane_start_point.resolve()).toBe(MAIN)
	})

	// The fallback is the stale reading this module exists to avoid, and `list_branches` answers the
	// same empty array for a git failure as for a repository with no remote — so it has to be said.
	it('says on stderr that the lane is being cut from the local branch', async () => {
		branch_names_remote.mockResolvedValue([])

		await lane_start_point.resolve()

		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(MAIN_TRACKING_REF))
	})

	// `git branch --list --remotes 'origin/main'` cannot match a local branch, but a near miss from
	// another remote must not be taken for the answer either.
	it('ignores a remote-tracking branch of the same name on another remote', async () => {
		branch_names_remote.mockResolvedValue([`upstream/${MAIN}`])

		expect(await lane_start_point.resolve()).toBe(MAIN)
	})
})
