import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { git_remote_branch, type RemoteAnswer } from '#scripts/git/git-remote-branch'
import { git_worktree } from '#scripts/git/git-worktree'
import { lane_install } from '#scripts/lane/lane-install'
import { lane_leftover } from '#scripts/lane/lane-leftover'
import { lane_paths } from '#scripts/lane/lane-paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { release_worktree } from './release-worktree'

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		get_default_branch: vi.fn(),
		branch_exists: vi.fn(),
		branch_names: vi.fn(),
		commit_count_beyond: vi.fn(),
	},
}))

vi.mock('#scripts/git/git-remote-branch', () => ({
	git_remote_branch: { ask: vi.fn() },
}))

vi.mock('#scripts/git/git-worktree', () => ({
	git_worktree: {
		worktree_add: vi.fn(),
		worktree_list: vi.fn(),
		worktree_remove: vi.fn(),
		branch_delete: vi.fn(),
	},
}))

vi.mock('#scripts/lane/lane-install', () => ({
	lane_install: { install_dependencies: vi.fn() },
}))

vi.mock('#scripts/lane/lane-leftover', () => ({
	lane_leftover: { reclaim: vi.fn() },
}))

const REPOSITORY_ROOT = '/repo/kit'
const REMOVE_DIR = '/repo/.kit-lanes/release'
const BRANCH = 'release/v1.2.0'
const DEFAULT_BRANCH = 'main'
const LANE_ISSUE_PATTERN = /^\d+$/u
const LEFTOVER_BRANCH = 'release/v1.1.0'
const ORIGIN_DEFAULT = 'origin/main'
const ADD_REFUSAL = 'already exists'
const AHEAD = 2

beforeEach(() => {
	vi.clearAllMocks()
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
		expect(git_worktree.worktree_add).toHaveBeenCalledWith(directory, BRANCH, ORIGIN_DEFAULT)
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

// `git worktree add -b` creates the branch before it checks the path, so a refused add used to leave
// `release/v<version>` behind for the next run's branch guard to trip on (joshuafolkken/kit#3058).
describe('release_worktree.create when the add fails', () => {
	it('deletes the branch the failed add created and rethrows', async () => {
		vi.mocked(git_worktree.worktree_add).mockRejectedValue(new Error(ADD_REFUSAL))
		vi.mocked(git_command.branch_exists).mockResolvedValue(true)

		await expect(release_worktree.create(BRANCH)).rejects.toThrow(ADD_REFUSAL)
		expect(git_worktree.branch_delete).toHaveBeenCalledWith(BRANCH)
		expect(lane_install.install_dependencies).not.toHaveBeenCalled()
	})

	it('deletes nothing when the failed add made no branch', async () => {
		vi.mocked(git_worktree.worktree_add).mockRejectedValue(new Error('locked'))
		vi.mocked(git_command.branch_exists).mockResolvedValue(false)

		await expect(release_worktree.create(BRANCH)).rejects.toThrow('locked')
		expect(git_worktree.branch_delete).not.toHaveBeenCalled()
	})
})

function given_leftover(answer: RemoteAnswer, ahead: number, is_tree_registered: boolean): void {
	const directory = release_worktree.directory_for(process.cwd())

	vi.mocked(git_command.branch_names).mockResolvedValue([LEFTOVER_BRANCH])
	vi.mocked(git_remote_branch.ask).mockResolvedValue(answer)
	vi.mocked(git_command.commit_count_beyond).mockResolvedValue(ahead)
	vi.mocked(git_worktree.worktree_list).mockResolvedValue(
		is_tree_registered ? `worktree ${directory}\nbranch refs/heads/${LEFTOVER_BRANCH}\n` : '',
	)
}

describe('release_worktree.clear_leftover', () => {
	// A run cut off before its `finally` leaves an unpushed, commit-less tree and branch; losing them
	// loses nothing, so they are cleared and the release goes on (joshuafolkken/kit#3058).
	it('removes an unpushed, commit-less leftover tree and its branch', async () => {
		given_leftover('absent', 0, true)

		await release_worktree.clear_leftover()

		expect(git_command.branch_names).toHaveBeenCalledWith('release/v*')
		expect(git_command.commit_count_beyond).toHaveBeenCalledWith(ORIGIN_DEFAULT, LEFTOVER_BRANCH)
		expect(git_worktree.worktree_remove).toHaveBeenCalledWith(
			release_worktree.directory_for(process.cwd()),
		)
		expect(git_worktree.branch_delete).toHaveBeenCalledWith(LEFTOVER_BRANCH)
	})

	it('hands a directory git does not register to the lane leftover check', async () => {
		given_leftover('absent', 0, false)

		await release_worktree.clear_leftover()

		expect(lane_leftover.reclaim).toHaveBeenCalledWith(
			release_worktree.directory_for(process.cwd()),
		)
		expect(git_worktree.worktree_remove).not.toHaveBeenCalled()
	})

	it('does nothing when no release branch and no tree are left', async () => {
		vi.mocked(git_command.branch_names).mockResolvedValue([])
		vi.mocked(git_worktree.worktree_list).mockResolvedValue('')

		await release_worktree.clear_leftover()

		expect(git_worktree.worktree_remove).not.toHaveBeenCalled()
		expect(git_worktree.branch_delete).not.toHaveBeenCalled()
	})
})

describe('release_worktree.clear_leftover when the directory was deleted by hand', () => {
	// git refuses `branch -D` while a tree still registered holds the branch, even one whose directory
	// is gone, so the registration is dropped before the branch goes.
	it('drops the registration of a tree whose directory was deleted by hand', async () => {
		given_leftover('absent', 0, true)

		await release_worktree.clear_leftover()

		const removed = vi.mocked(git_worktree.worktree_remove).mock.invocationCallOrder[0] ?? 0

		expect(removed).toBeGreaterThan(0)
		expect(removed).toBeLessThan(
			vi.mocked(git_worktree.branch_delete).mock.invocationCallOrder[0] ?? 0,
		)
		expect(lane_leftover.reclaim).not.toHaveBeenCalled()
	})
})

describe('release_worktree.clear_leftover when a branch may still be in use', () => {
	it('keeps a pushed branch and names it with the removal commands', async () => {
		given_leftover('present', 0, true)

		await expect(release_worktree.clear_leftover()).rejects.toThrow(
			`\`${LEFTOVER_BRANCH}\`: origin answers \`present\` for it`,
		)
		expect(git_worktree.worktree_remove).not.toHaveBeenCalled()
		expect(git_worktree.branch_delete).not.toHaveBeenCalled()
	})

	it('keeps a branch holding a commit beyond the default and says how many', async () => {
		given_leftover('absent', AHEAD, true)

		await expect(release_worktree.clear_leftover()).rejects.toThrow(
			`git branch -D ${LEFTOVER_BRANCH}`,
		)
		await expect(release_worktree.clear_leftover()).rejects.toThrow(
			`it holds ${String(AHEAD)} commit(s) not on \`${ORIGIN_DEFAULT}\``,
		)
		expect(git_worktree.branch_delete).not.toHaveBeenCalled()
	})

	// A remote that cannot be asked is not read as "not pushed".
	it('keeps the branch when origin cannot be asked', async () => {
		given_leftover('unreachable', 0, true)

		await expect(release_worktree.clear_leftover()).rejects.toThrow('`unreachable`')
		expect(git_worktree.branch_delete).not.toHaveBeenCalled()
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
