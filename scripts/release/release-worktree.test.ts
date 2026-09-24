import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { git_worktree } from '#scripts/git/git-worktree'
import { lane_install } from '#scripts/lane/lane-install'
import { lane_paths } from '#scripts/lane/lane-paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { release_worktree } from './release-worktree'

vi.mock('#scripts/git/git-command', () => ({
	git_command: { get_default_branch: vi.fn() },
}))

vi.mock('#scripts/git/git-worktree', () => ({
	git_worktree: { worktree_add: vi.fn(), worktree_remove: vi.fn(), branch_delete: vi.fn() },
}))

vi.mock('#scripts/lane/lane-install', () => ({
	lane_install: { install_dependencies: vi.fn() },
}))

const REPOSITORY_ROOT = '/repo/kit'
const REMOVE_DIR = '/repo/.kit-lanes/release'
const BRANCH = 'release/v1.2.0'
const DEFAULT_BRANCH = 'main'
const LANE_ISSUE_PATTERN = /^\d+$/u

beforeEach(() => {
	vi.mocked(git_command.get_default_branch).mockResolvedValue(DEFAULT_BRANCH)
	vi.mocked(git_worktree.worktree_add).mockResolvedValue('')
	vi.mocked(git_worktree.worktree_remove).mockResolvedValue('')
	vi.mocked(git_worktree.branch_delete).mockResolvedValue('')
	vi.mocked(lane_install.install_dependencies).mockResolvedValue({ is_installed: true, output: '' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('release_worktree.directory_for', () => {
	// It lives under the same sibling hidden directory the lanes do, so it inherits the "not inside
	// the repository" placement without being a lane itself.
	it('sits under the lane root, beside the repository', () => {
		const directory = release_worktree.directory_for(REPOSITORY_ROOT)

		expect(directory).toBe(path.join(lane_paths.lane_root(REPOSITORY_ROOT), 'release'))
		expect(path.dirname(directory)).not.toBe(REPOSITORY_ROOT)
	})

	// Lanes are named by their numeric issue number; a non-numeric name collides with none of them.
	it('is named so it collides with no lane', () => {
		const name = path.basename(release_worktree.directory_for(REPOSITORY_ROOT))

		expect(name).toBe(release_worktree.RELEASE_WORKTREE_NAME)
		expect(LANE_ISSUE_PATTERN.test(name)).toBe(false)
	})
})

describe('release_worktree.create', () => {
	it('cuts the tree from origin/<default> as the release branch', async () => {
		const directory = await release_worktree.create(BRANCH)

		expect(directory).toBe(release_worktree.directory_for(process.cwd()))
		expect(git_worktree.worktree_add).toHaveBeenCalledWith(directory, BRANCH, 'origin/main')
	})

	it('installs the dependencies the release commit hook needs', async () => {
		const directory = await release_worktree.create(BRANCH)

		expect(lane_install.install_dependencies).toHaveBeenCalledWith(directory)
	})

	// A failed install cleans up the tree it created rather than leaving debris behind.
	it('removes the tree and reports when the install fails', async () => {
		vi.mocked(lane_install.install_dependencies).mockResolvedValue({
			is_installed: false,
			output: 'boom',
		})

		await expect(release_worktree.create(BRANCH)).rejects.toThrow('boom')
		expect(git_worktree.worktree_remove).toHaveBeenCalledTimes(1)
		expect(git_worktree.branch_delete).toHaveBeenCalledWith(BRANCH)
	})
})

describe('release_worktree.remove', () => {
	// The tree goes first — a branch checked out in a work tree cannot be deleted.
	it('removes the tree and then its local branch', async () => {
		await release_worktree.remove(REMOVE_DIR, BRANCH)

		expect(git_worktree.worktree_remove).toHaveBeenCalledWith(REMOVE_DIR)
		expect(git_worktree.branch_delete).toHaveBeenCalledWith(BRANCH)
	})
})
