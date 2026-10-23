import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4642: the first scoped check past the split guide shows the notice `josh
// main:merge` shows, once per Issue, and stays silent under the guide.

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		branch: vi.fn(),
		diff_main_numstat: vi.fn(),
		git_directories: vi.fn(),
		untracked_names: vi.fn(),
	},
}))

const { git_command } = await import('#scripts/git/git-command')
const { split_assess } = await import('./split-assess')
const { split_early_notice } = await import('./split-early-notice')

const ISSUE_NUMBER = 4642
const ISSUE_BRANCH = `${String(ISSUE_NUMBER)}-lane`
const LINES_PER_FILE = 50
const UNDER_GUIDE_NUMSTAT = `${String(LINES_PER_FILE)}\t0\tscripts/a.ts`

function numstat_of(file_count: number): string {
	return Array.from(
		{ length: file_count },
		(_unused, index) => `${String(LINES_PER_FILE)}\t0\tscripts/thing-${String(index)}.ts`,
	).join('\n')
}

const OVER_GUIDE_NUMSTAT = numstat_of(split_assess.FILE_GUIDE + 1)
// Exactly at the file guide: the notice's bar is strictly greater than, as `main:merge`'s is.
const AT_GUIDE_NUMSTAT = numstat_of(split_assess.FILE_GUIDE)

const GIT_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'split-early-notice-'))

function marker(): string {
	return path.join(GIT_DIRECTORY, `${split_early_notice.MARKER_PREFIX}${String(ISSUE_NUMBER)}`)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	vi.mocked(git_command.branch).mockResolvedValue(ISSUE_BRANCH)
	vi.mocked(git_command.git_directories).mockResolvedValue([GIT_DIRECTORY])
	vi.mocked(git_command.untracked_names).mockResolvedValue('')
	vi.mocked(git_command.diff_main_numstat).mockResolvedValue(OVER_GUIDE_NUMSTAT)
})

afterEach(async () => {
	await rm(marker(), { force: true })
})

afterAll(async () => {
	await rm(GIT_DIRECTORY, { recursive: true, force: true })
})

describe('split_early_notice.surface over the guide', () => {
	it('shows the same notice main:merge prints', async () => {
		await split_early_notice.surface()

		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('split notice'))
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(split_assess.NOTICE_SECTION))
	})

	it('shows it once per issue', async () => {
		await split_early_notice.surface()
		await split_early_notice.surface()

		expect(console.warn).toHaveBeenCalledOnce()
	})
})

describe('split_early_notice.surface under the guide', () => {
	it('prints nothing and leaves no marker, so a later crossing still shows', async () => {
		vi.mocked(git_command.diff_main_numstat).mockResolvedValue(AT_GUIDE_NUMSTAT)
		await split_early_notice.surface()

		expect(console.warn).not.toHaveBeenCalled()
		expect(existsSync(marker())).toBe(false)

		vi.mocked(git_command.diff_main_numstat).mockResolvedValue(OVER_GUIDE_NUMSTAT)
		await split_early_notice.surface()

		expect(console.warn).toHaveBeenCalledOnce()
	})

	it('prints nothing for a small diff', async () => {
		vi.mocked(git_command.diff_main_numstat).mockResolvedValue(UNDER_GUIDE_NUMSTAT)
		await split_early_notice.surface()

		expect(console.warn).not.toHaveBeenCalled()
	})
})

describe('split_early_notice.surface off an issue', () => {
	it('prints nothing on a branch with no issue', async () => {
		vi.mocked(git_command.branch).mockResolvedValue('main')
		await split_early_notice.surface()

		expect(console.warn).not.toHaveBeenCalled()
	})

	it('prints nothing when the diff cannot be read', async () => {
		vi.mocked(git_command.diff_main_numstat).mockRejectedValue(new Error('no base'))

		await expect(split_early_notice.surface()).resolves.toBeUndefined()
		expect(console.warn).not.toHaveBeenCalled()
	})
})
