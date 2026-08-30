import os from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./git/git-command', () => ({
	git_command: { branch: vi.fn(), git_directories: vi.fn() },
}))

vi.mock('node:fs', () => ({
	readFileSync: vi.fn(),
}))

const { git_command } = await import('./git/git-command')
const { readFileSync: read_file_sync } = await import('node:fs')

const mocked_branch = vi.mocked(git_command.branch)
const mocked_git_directories = vi.mocked(git_command.git_directories)
const mocked_read = vi.mocked(read_file_sync)

mocked_branch.mockResolvedValue('main')
mocked_git_directories.mockResolvedValue([])

const { check_commit_message, extract_issue_number, is_safe_commit_message_path } =
	await import('./check-commit-message')

beforeEach(() => {
	vi.clearAllMocks()
})

// What `git rev-parse` answers in a linked work tree: the work tree's own git directory first, then
// the common one it shares with the main tree. The main tree answers the same path twice, which the
// containment test handles without a case of its own.
const MAIN_GIT_DIRECTORY = `${process.cwd()}/.git`
const WORKTREE_GIT_DIRECTORY = `${MAIN_GIT_DIRECTORY}/worktrees/bridge-example`
const GIT_DIRECTORIES: ReadonlyArray<string> = [WORKTREE_GIT_DIRECTORY, MAIN_GIT_DIRECTORY]

describe('is_safe_commit_message_path', () => {
	it('accepts the relative path the main work tree passes', () => {
		expect(is_safe_commit_message_path('.git/COMMIT_EDITMSG', GIT_DIRECTORIES)).toBe(true)
	})

	it('accepts an OS temp dir path', () => {
		const temporary_path = `${os.tmpdir()}/commit-msg`

		expect(is_safe_commit_message_path(temporary_path, GIT_DIRECTORIES)).toBe(true)
	})

	// joshuafolkken/kit#1106: the shape a linked work tree produces. It is absolute and shares no
	// prefix with `.git/`, so the prefix test this guard used to be refused it — before the real
	// check ran, which made every commit inside a work tree impossible.
	it('accepts the absolute path a linked work tree passes', () => {
		const worktree_path = `${WORKTREE_GIT_DIRECTORY}/COMMIT_EDITMSG`

		expect(is_safe_commit_message_path(worktree_path, GIT_DIRECTORIES)).toBe(true)
	})

	// The directories come from git, so a repository whose git directory is not named `.git` — a bare
	// one, or a `--separate-git-dir` clone — is accepted for the same reason and by the same code.
	it('accepts a git directory that is not named .git', () => {
		const bare_directory = '/srv/project.git'
		const bare_path = `${bare_directory}/worktrees/feature/COMMIT_EDITMSG`

		expect(is_safe_commit_message_path(bare_path, [bare_directory])).toBe(true)
	})

	it.each(['/etc/passwd', 'commit-msg', MAIN_GIT_DIRECTORY])('rejects %j', (file_path) => {
		expect(is_safe_commit_message_path(file_path, GIT_DIRECTORIES)).toBe(false)
	})

	// Containment is decided on the resolved path, not on the spelling. A prefix test would read the
	// `.git/` at the front and hand `readFileSync` a file outside the repository — and the error
	// message would then print its contents back.
	it('rejects a path that climbs back out of a git directory', () => {
		const traversal_path = '.git/../../../../etc/passwd'

		expect(is_safe_commit_message_path(traversal_path, GIT_DIRECTORIES)).toBe(false)
	})
})

describe('extract_issue_number', () => {
	it('returns the issue number from a valid branch name', () => {
		expect(extract_issue_number('123-fix-bug')).toBe('123')
	})

	it('returns undefined for main branch', () => {
		expect(extract_issue_number('main')).toBeUndefined()
	})

	it('returns undefined for a branch without a leading number', () => {
		expect(extract_issue_number('fix-bug')).toBeUndefined()
	})
})

describe('check_commit_message — branch without issue number', () => {
	it('returns success when branch has no issue number', async () => {
		mocked_branch.mockResolvedValue('main')

		const result = await check_commit_message()

		expect(result.success).toBe(true)
		expect(result.message).toContain('no issue number required')
	})
})

describe('check_commit_message — branch with issue number', () => {
	const ISSUE_BRANCH = '42-fix-bug'
	const MATCHING_MESSAGE = 'Fix the bug #42'

	it('returns success when commit message contains the issue number', async () => {
		mocked_branch.mockResolvedValue(ISSUE_BRANCH)
		mocked_read.mockReturnValue(MATCHING_MESSAGE)

		const result = await check_commit_message()

		expect(result.success).toBe(true)
		expect(result.message).toContain('#42')
	})

	it('returns failure when commit message is missing the issue number', async () => {
		mocked_branch.mockResolvedValue(ISSUE_BRANCH)
		mocked_read.mockReturnValue('Fix the bug')

		const result = await check_commit_message()

		expect(result.success).toBe(false)
		expect(result.message).toContain('#42')
	})

	// joshuafolkken/kit#1106: with no path passed, the file is read from the work tree's own git
	// directory. The relative `.git/COMMIT_EDITMSG` this used to hardcode names a *file* in a linked
	// work tree, so reading through it ends at ENOTDIR — the same defect as the guard's, on the
	// branch the guard never reaches because there is no argument to check.
	it('reads from the git directory git reports, not a literal .git', async () => {
		mocked_branch.mockResolvedValue(ISSUE_BRANCH)
		mocked_git_directories.mockResolvedValue([WORKTREE_GIT_DIRECTORY, MAIN_GIT_DIRECTORY])
		mocked_read.mockReturnValue(MATCHING_MESSAGE)

		await check_commit_message()

		expect(mocked_read).toHaveBeenCalledWith(
			`${WORKTREE_GIT_DIRECTORY}/COMMIT_EDITMSG`,
			expect.anything(),
		)
	})
})
