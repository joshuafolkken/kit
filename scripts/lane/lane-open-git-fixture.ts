import { mkdirSync } from 'node:fs'
import { vi } from 'vitest'

// The git half of `lane-open.test.ts`'s harness: what this module asks git for is asserted there, not
// git itself — `git-worktree.test.ts` pins the flags of the worktree calls.

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		branch_exists: vi.fn(),
		branch_names_remote: vi.fn(),
		default_branch_reference: vi.fn(),
		fetch_branch: vi.fn(),
		get_default_branch: vi.fn(),
	},
}))
vi.mock('#scripts/git/git-worktree', () => ({
	git_worktree: { ls_remote_branch: vi.fn(), set_upstream: vi.fn(), worktree_add: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const { git_worktree } = await import('#scripts/git/git-worktree')

const START_POINT = 'refs/remotes/origin/main'

function git_answers(): void {
	vi.mocked(git_command.get_default_branch).mockResolvedValue('main')
	vi.mocked(git_command.fetch_branch).mockResolvedValue('')
	// No branch of the lane's name anywhere, which is what opening a lane for a fresh child finds
	// (joshuafolkken/kit#1627). The suite that drives the other two answers is
	// `lane-open-start-point.test.ts`, against real git.
	vi.mocked(git_command.branch_exists).mockResolvedValue(false)
	vi.mocked(git_command.branch_names_remote).mockResolvedValue([])
	vi.mocked(git_worktree.ls_remote_branch).mockResolvedValue('')
	vi.mocked(git_command.default_branch_reference).mockResolvedValue(START_POINT)
	// Stands in for what `git worktree add` does to the filesystem, so the `.env` write that follows
	// it has somewhere to land.
	vi.mocked(git_worktree.worktree_add).mockImplementation(async (directory: string) => {
		mkdirSync(directory, { recursive: true })

		return ''
	})
}

const lane_open_git = { git_answers, git_command, git_worktree, START_POINT }

export { lane_open_git }
