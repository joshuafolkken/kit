import { mkdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4302: a branch's new files are untracked when it is measured, and `git diff`
// never lists them, so the measurement adds them itself.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { diff_numstat_since: vi.fn(), untracked_names: vi.fn() },
}))
vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))
vi.mock('#scripts/git/change-base', () => ({ change_base: { resolved_through_merge: vi.fn() } }))
vi.mock('#scripts/lane/lane-implement-rate-read', () => ({
	lane_implement_rate_read: { measurements: vi.fn() },
}))
vi.mock('./split-relocations', () => ({
	split_relocations: {
		without_relocations: vi.fn(
			async (_root: string, _base: string, numstat: string, added: Array<string>) => ({
				numstat,
				added,
			}),
		),
	},
}))

const { change_base } = await import('#scripts/git/change-base')
const { git_command } = await import('#scripts/git/git-command')
const { git_spawn } = await import('#scripts/git/git-spawn')
const { split_measure } = await import('./split-measure')
const { split_assess } = await import('./split-assess')
const { lane_implement_rate_read } = await import('#scripts/lane/lane-implement-rate-read')

const NEW_FILE_COUNT = 11
const NEW_FILE_LINES = 50
const TREE_BASE = 'tree-base-commit'
const LEGACY_GUIDE = split_assess.guide_for(12, undefined, {})
const SMALL_DIFF = '51\t0\tscripts/a.ts'

const fixture = { root: '' }
const make_directory = temporary_directory()

function lines_of(count: number): string {
	return 'line\n'.repeat(count)
}

beforeEach(() => {
	fixture.root = make_directory('split-measure-')
	vi.mocked(git_spawn.read).mockResolvedValue(`${fixture.root}\n`)
	vi.mocked(git_command.diff_numstat_since).mockResolvedValue('')
	vi.mocked(git_command.untracked_names).mockResolvedValue('')
	vi.mocked(change_base.resolved_through_merge).mockResolvedValue(TREE_BASE)
	vi.mocked(lane_implement_rate_read.measurements).mockResolvedValue({
		implement_rate: undefined,
		growth: {},
	})
})

// joshuafolkken/kit#6724: the files the branch adds reach the measure, so a new module and the
// importer of its directory count as one file, as `lane:plan` counts them.
describe('read_branch on a new module and its importer', () => {
	it('counts an untracked module and the tracked importer of its directory as one file', async () => {
		await mkdir(path.join(fixture.root, 'scripts/x'), { recursive: true })
		const new_module = 'scripts/x/new.ts'

		await writeFile(path.join(fixture.root, new_module), lines_of(NEW_FILE_LINES))
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue('5\t0\tscripts/x/cli.ts')
		vi.mocked(git_command.untracked_names).mockResolvedValue(new_module)

		const measurement = await split_measure.read_branch()

		expect(measurement.files).toBe(1)
		expect(measurement.lines).toBe(NEW_FILE_LINES + 5)
	})
})

describe('read_branch excludes quoted tests', () => {
	it('excludes an untracked C-quoted test file over the line guide', async () => {
		const file = 'quote"name.test.ts'

		await writeFile(path.join(fixture.root, file), lines_of(201))
		vi.mocked(git_command.untracked_names).mockResolvedValue(JSON.stringify(file))

		expect(await split_measure.read_branch()).toStrictEqual({
			files: 0,
			lines: 0,
			verdict: 'single',
			guide: LEGACY_GUIDE,
		})
	})
})

describe('read_branch measured guide', () => {
	it('carries growth without speed into notices and reasons (ac-75138e94)', async () => {
		vi.mocked(lane_implement_rate_read.measurements).mockResolvedValue({
			implement_rate: undefined,
			growth: { files: 1, lines: 1.25 },
		})
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(SMALL_DIFF)
		const measured = await split_measure.read_branch()
		const notice = split_assess.notice(measured, { files: 1, lines: 40 })

		expect(notice).toContain('growth files × 1 (measured) / lines × 1.25 (measured)')
		expect(split_assess.reason(measured)).toContain('guide 8 files / 200 lines (fallback)')
	})

	it('floors the measured budget guide for verdict, reason and notices (ac-9e07d12c)', async () => {
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(SMALL_DIFF)
		vi.mocked(lane_implement_rate_read.measurements).mockResolvedValue({
			implement_rate: { median: 24, lanes: 1 },
			growth: {},
		})
		const measured = await split_measure.read_branch()

		expect(measured.verdict).toBe('single')
		expect(measured.guide).toEqual(LEGACY_GUIDE)
		expect(split_assess.reason(measured)).toContain('guide 8 files / 200 lines')
		expect(split_assess.notice(measured)).toBeUndefined()
	})

	it('keeps the same diff single when no implement rate is measured (ac-9e07d12c)', async () => {
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(SMALL_DIFF)
		const unmeasured = await split_measure.read_branch()

		expect(unmeasured.verdict).toBe('single')
		expect(split_assess.notice(unmeasured)).toBeUndefined()
	})
})

describe('read_branch', () => {
	it('counts the untracked files a branch created, so new modules reach split', async () => {
		const names = Array.from(
			{ length: NEW_FILE_COUNT },
			(_unused, index) => `new-${String(index)}.ts`,
		)

		await Promise.all(
			names.map(async (name) => {
				await writeFile(path.join(fixture.root, name), lines_of(NEW_FILE_LINES))
			}),
		)
		vi.mocked(git_command.untracked_names).mockResolvedValue(names.join('\n'))

		expect(await split_measure.read_branch()).toStrictEqual({
			files: NEW_FILE_COUNT,
			lines: NEW_FILE_COUNT * NEW_FILE_LINES,
			verdict: 'split',
			guide: LEGACY_GUIDE,
		})
	})

	it('measures the tracked diff alone when nothing is untracked', async () => {
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue('3\t2\tscripts/a.ts')

		expect(await split_measure.read_branch()).toStrictEqual({
			files: 1,
			lines: 5,
			verdict: 'single',
			guide: LEGACY_GUIDE,
		})
	})
})

describe('read_branch excludes run records', () => {
	it('keeps one deliverable under its declared boundary with tracked and untracked records', async () => {
		const record = '.josh/observations/6391.md'

		await mkdir(path.join(fixture.root, '.josh/observations'), { recursive: true })
		await writeFile(path.join(fixture.root, record), lines_of(NEW_FILE_LINES))
		vi.mocked(git_command.untracked_names).mockResolvedValue(record)
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(
			'1\t0\tscripts/a.ts\n50\t0\tscripts/a.test.ts\n50\t0\t.josh/metrics-accepted/6391.json',
		)
		const measurement = await split_measure.read_branch()

		expect(measurement).toEqual({ files: 1, lines: 1, verdict: 'single', guide: LEGACY_GUIDE })
		expect(split_assess.notice(measurement, { files: 1, lines: 10 })).toBeUndefined()
	})
})

// joshuafolkken/kit#4696: a merge stopped on a conflict holds the default branch's files in the tree,
// so the diff is taken from the tree's base rather than `HEAD`'s.
describe('read_branch base', () => {
	it('measures the tracked diff from the base through a merge in progress', async () => {
		await split_measure.read_branch()

		expect(git_command.diff_numstat_since).toHaveBeenCalledWith(TREE_BASE)
	})

	it('rejects when the base cannot be resolved, so the diff reads as unmeasured', async () => {
		vi.mocked(change_base.resolved_through_merge).mockResolvedValue(undefined)

		await expect(split_measure.read_branch()).rejects.toThrow('change base')
	})
})

describe('read_branch with an unreadable untracked entry', () => {
	it('counts it as a zero-line file instead of failing', async () => {
		await symlink(path.join(fixture.root, 'missing.ts'), path.join(fixture.root, 'dangling.ts'))
		await mkdir(path.join(fixture.root, 'nested-repo'))
		vi.mocked(git_command.untracked_names).mockResolvedValue('dangling.ts\nnested-repo/')

		expect(await split_measure.read_branch()).toStrictEqual({
			files: 2,
			lines: 0,
			verdict: 'single',
			guide: LEGACY_GUIDE,
		})
	})
})

describe('line_count', () => {
	it('counts a last line with no trailing newline', () => {
		expect(split_measure.line_count(Buffer.from('a\nb'))).toBe(2)
	})

	it('counts an empty file as zero lines', () => {
		expect(split_measure.line_count(Buffer.from(''))).toBe(0)
	})

	it('counts a binary file as zero lines, as git numstat does', () => {
		expect(split_measure.line_count(Buffer.from([1, 0, 1]))).toBe(0)
	})
})
