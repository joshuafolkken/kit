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
		diff_numstat_since: vi.fn(),
		git_directories: vi.fn(),
		untracked_names: vi.fn(),
	},
}))

vi.mock('#scripts/git/change-base', () => ({
	change_base: { resolved_through_merge: vi.fn().mockResolvedValue('base') },
}))

const { git_command } = await import('#scripts/git/git-command')
const { lane_ledger_write } = await import('#scripts/lane/lane-ledger-write')
const { split_assess } = await import('./split-assess')
const { split_early_notice } = await import('./split-early-notice')
const { split_measure } = await import('./split-measure')

const record_split_notice = vi.spyOn(lane_ledger_write, 'record_split_notice')

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
	vi.mocked(git_command.diff_numstat_since).mockResolvedValue(OVER_GUIDE_NUMSTAT)
	record_split_notice.mockResolvedValue()
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

// joshuafolkken/kit#4695: the first showing is written to the lane ledger, whichever command showed it.
const OVER_GUIDE_NOTICE = {
	issue: ISSUE_NUMBER,
	files: split_assess.FILE_GUIDE + 1,
	lines: (split_assess.FILE_GUIDE + 1) * LINES_PER_FILE,
}

describe('the split notice in the lane ledger', () => {
	it('records the first surfaced notice with its counts, once', async () => {
		await split_early_notice.surface()
		await split_early_notice.surface()

		expect(record_split_notice).toHaveBeenCalledExactlyOnceWith(OVER_GUIDE_NOTICE)
	})

	it('records the notice main:merge printed, once', async () => {
		const measurement = await split_measure.read_branch()

		await split_early_notice.record(measurement)
		await split_early_notice.record(measurement)

		expect(record_split_notice).toHaveBeenCalledExactlyOnceWith(OVER_GUIDE_NOTICE)
	})

	it('records nothing from main:merge once a scoped check showed the notice', async () => {
		await split_early_notice.surface()
		record_split_notice.mockClear()

		await split_early_notice.record(await split_measure.read_branch())

		expect(record_split_notice).not.toHaveBeenCalled()
	})
})

describe('split_early_notice.surface under the guide', () => {
	it('prints nothing and leaves no marker, so a later crossing still shows', async () => {
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(AT_GUIDE_NUMSTAT)
		await split_early_notice.surface()

		expect(console.warn).not.toHaveBeenCalled()
		expect(existsSync(marker())).toBe(false)

		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(OVER_GUIDE_NUMSTAT)
		await split_early_notice.surface()

		expect(console.warn).toHaveBeenCalledOnce()
	})

	it('prints nothing for a small diff', async () => {
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(UNDER_GUIDE_NUMSTAT)
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
		vi.mocked(git_command.diff_numstat_since).mockRejectedValue(new Error('no base'))

		await expect(split_early_notice.surface()).resolves.toBeUndefined()
		expect(console.warn).not.toHaveBeenCalled()
	})
})
