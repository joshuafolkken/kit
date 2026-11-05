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
vi.mock('#scripts/lane/lane-implement-rate-read', () => ({
	lane_implement_rate_read: { implement_rate: vi.fn() },
}))

vi.mock('./split-relocations', () => ({
	split_relocations: {
		without_relocations: vi.fn(async (_root: string, _base: string, numstat: string) => numstat),
	},
}))

const { git_command } = await import('#scripts/git/git-command')
const { issue_declared_size } = await import('#scripts/issue/issue-declared-size')
const { lane_ledger_write } = await import('#scripts/lane/lane-ledger-write')
const { split_assess } = await import('./split-assess')
const { split_early_notice } = await import('./split-early-notice')
const { split_measure } = await import('./split-measure')
const { lane_implement_rate_read } = await import('#scripts/lane/lane-implement-rate-read')

const record_split_notice = vi.spyOn(lane_ledger_write, 'record_split_notice')
// The Issue body read; no declared size by default, so the guide is the bar.
const read_declared = vi.spyOn(issue_declared_size, 'read')

const ISSUE_NUMBER = 4642
const ISSUE_BRANCH = `${String(ISSUE_NUMBER)}-lane`
// Small enough that the file guide alone decides: the guide's line axis stays under at FILE_GUIDE files.
const LINES_PER_FILE = 25
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
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	vi.mocked(git_command.branch).mockResolvedValue(ISSUE_BRANCH)
	vi.mocked(git_command.git_directories).mockResolvedValue([GIT_DIRECTORY])
	vi.mocked(git_command.untracked_names).mockResolvedValue('')
	vi.mocked(git_command.diff_numstat_since).mockResolvedValue(OVER_GUIDE_NUMSTAT)
	record_split_notice.mockResolvedValue()
	read_declared.mockResolvedValue(undefined)
	vi.mocked(lane_implement_rate_read.implement_rate).mockResolvedValue(undefined)
})

afterEach(async () => {
	await rm(marker(), { force: true })
	await rm(
		path.join(GIT_DIRECTORY, `${split_early_notice.DECLARED_PREFIX}${String(ISSUE_NUMBER)}`),
		{
			force: true,
		},
	)
})

afterAll(async () => {
	await rm(GIT_DIRECTORY, { recursive: true, force: true })
})

describe('split_early_notice.surface over the guide', () => {
	it('uses the measured guide below the legacy bar (ac-9e07d12c)', async () => {
		vi.mocked(lane_implement_rate_read.implement_rate).mockResolvedValue({ median: 24, lanes: 1 })
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(numstat_of(3))
		await split_early_notice.surface()

		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('guide 2 files / 50 lines'))
	})

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

// joshuafolkken/kit#6206: the bar is the branch Issue's declared size grown, under the guide too.
describe('split_early_notice.surface against a declared size', () => {
	it('shows the notice at 7 files for an issue declaring 3', async () => {
		read_declared.mockResolvedValue({ files: 3, lines: 400 })
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(numstat_of(7))
		await split_early_notice.surface()

		expect(read_declared).toHaveBeenCalledWith(String(ISSUE_NUMBER))
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('declared 3 files'))
	})

	it('falls back to the guide when the body cannot be read', async () => {
		read_declared.mockRejectedValue(new Error('gh down'))
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(OVER_GUIDE_NUMSTAT)
		await split_early_notice.surface()

		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('guide 8 files'))
	})
})

describe('split_early_notice.declared', () => {
	it('reads the branch issue declared size', async () => {
		read_declared.mockResolvedValue({ files: 3, lines: 40 })

		expect(await split_early_notice.declared()).toEqual({ files: 3, lines: 40 })
	})

	it('is undefined on a branch with no issue', async () => {
		vi.mocked(git_command.branch).mockResolvedValue('main')

		expect(await split_early_notice.declared()).toBeUndefined()
		expect(read_declared).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#6206: a scoped check runs after every edit batch, so the Issue is read once.
describe('split_early_notice keeps the declared size', () => {
	it('reads the issue once across runs under the bar', async () => {
		read_declared.mockResolvedValue({ files: 3, lines: 40 })
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(UNDER_GUIDE_NUMSTAT)
		await split_early_notice.surface()
		await split_early_notice.surface()

		expect(read_declared).toHaveBeenCalledOnce()
		expect(await split_early_notice.declared()).toEqual({ files: 3, lines: 40 })
	})

	it('keeps an issue with no declaration as none', async () => {
		await split_early_notice.declared()

		expect(await split_early_notice.declared()).toBeUndefined()
		expect(read_declared).toHaveBeenCalledOnce()
	})

	it('reads again after a read that threw', async () => {
		read_declared.mockRejectedValueOnce(new Error('gh down'))
		await split_early_notice.declared()
		await split_early_notice.declared()

		expect(read_declared).toHaveBeenCalledTimes(2)
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
