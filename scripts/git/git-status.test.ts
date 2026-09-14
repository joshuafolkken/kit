import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_status } from './git-status'

vi.mock('./animation-helpers', () => ({
	animation_helpers: {
		execute_with_animation: vi
			.fn()
			.mockImplementation(
				async (_message: string, action: () => Promise<unknown>, _options: unknown) =>
					await action(),
			),
	},
}))

vi.mock('./git-command', () => ({
	git_command: {
		status: vi.fn(),
		diff_cached: vi.fn(),
		diff_main: vi.fn(),
	},
}))

const { git_command } = await import('./git-command')
const mocked_status = vi.mocked(git_command.status)
const mocked_diff_cached = vi.mocked(git_command.diff_cached)

const UNTRACKED_FILE = 'new-file.ts'
const UNTRACKED_LINES = `?? ${UNTRACKED_FILE}\n?? another.ts\n`
const STAGED_CLEAN = 'M  package.json\n'
const UNSTAGED_MODIFIED = ' M git-status.ts\n'

beforeEach(() => {
	vi.clearAllMocks()
})

describe('git_status.list_untracked_files', () => {
	it('returns empty array for empty status output', () => {
		expect(git_status.list_untracked_files('')).toStrictEqual([])
	})

	it('extracts paths from "?? " porcelain lines and ignores other states', () => {
		const status_output = [
			' M scripts/git/git-staging.ts',
			'?? scripts/claude/claude-settings.test.ts',
			'A  src/lib/new-thing.ts',
			'?? .claude/scheduled_tasks.lock',
			'MM existing.ts',
		].join('\n')

		expect(git_status.list_untracked_files(status_output)).toStrictEqual([
			'scripts/claude/claude-settings.test.ts',
			'.claude/scheduled_tasks.lock',
		])
	})

	it('returns filenames for untracked lines', () => {
		const result = git_status.list_untracked_files(UNTRACKED_LINES)

		expect(result).toStrictEqual([UNTRACKED_FILE, 'another.ts'])
	})

	it('filters out staged and modified lines', () => {
		const result = git_status.list_untracked_files(
			`${STAGED_CLEAN}?? ${UNTRACKED_FILE}\n${UNSTAGED_MODIFIED}`,
		)

		expect(result).toStrictEqual([UNTRACKED_FILE])
	})

	it('returns empty array when there are only staged files', () => {
		expect(git_status.list_untracked_files(STAGED_CLEAN)).toStrictEqual([])
	})
})

describe('git_status.check_unstaged', () => {
	it('returns true when status output contains untracked files', async () => {
		mocked_status.mockResolvedValue(UNTRACKED_LINES)
		const has_unstaged = await git_status.check_unstaged()

		expect(has_unstaged).toBe(true)
	})

	it('returns false when all files are staged', async () => {
		mocked_status.mockResolvedValue(STAGED_CLEAN)
		const has_unstaged = await git_status.check_unstaged()

		expect(has_unstaged).toBe(false)
	})

	it('returns false for empty status output', async () => {
		mocked_status.mockResolvedValue('')
		const has_unstaged = await git_status.check_unstaged()

		expect(has_unstaged).toBe(false)
	})
})

describe('git_status.check_all_staged', () => {
	it('returns true when status is empty', async () => {
		mocked_status.mockResolvedValue('')
		const is_all_staged = await git_status.check_all_staged()

		expect(is_all_staged).toBe(true)
	})

	it('returns false when there are unstaged modifications', async () => {
		mocked_status.mockResolvedValue(UNSTAGED_MODIFIED)
		const is_all_staged = await git_status.check_all_staged()

		expect(is_all_staged).toBe(false)
	})
})

describe('git_status.check_package_json_staged', () => {
	it('returns true when package.json is staged', async () => {
		mocked_status.mockResolvedValue(STAGED_CLEAN)
		const is_staged = await git_status.check_package_json_staged()

		expect(is_staged).toBe(true)
	})

	it('returns false when package.json is not staged', async () => {
		mocked_status.mockResolvedValue(UNSTAGED_MODIFIED)
		const is_staged = await git_status.check_package_json_staged()

		expect(is_staged).toBe(false)
	})
})

describe('git_status.check_package_json_version', () => {
	it('returns true when diff contains a version change', async () => {
		mocked_diff_cached.mockResolvedValue('+  "version": "1.2.0",\n-  "version": "1.1.0",\n')
		const is_updated = await git_status.check_package_json_version()

		expect(is_updated).toBe(true)
	})

	it('returns false when diff has no version change', async () => {
		mocked_diff_cached.mockResolvedValue('+  "description": "changed",\n')
		const is_updated = await git_status.check_package_json_version()

		expect(is_updated).toBe(false)
	})
})
