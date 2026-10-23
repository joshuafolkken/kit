import { mkdtempSync } from 'node:fs'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4302: a branch's new files are untracked when it is measured, and `git diff`
// never lists them, so the measurement adds them itself.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { diff_numstat_since: vi.fn(), untracked_names: vi.fn() },
}))
vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))
vi.mock('#scripts/git/change-base', () => ({ change_base: { resolved_through_merge: vi.fn() } }))

const { change_base } = await import('#scripts/git/change-base')
const { git_command } = await import('#scripts/git/git-command')
const { git_spawn } = await import('#scripts/git/git-spawn')
const { split_measure } = await import('./split-measure')

const NEW_FILE_COUNT = 11
const NEW_FILE_LINES = 50
const TREE_BASE = 'tree-base-commit'

const fixture = { root: '' }

function lines_of(count: number): string {
	return 'line\n'.repeat(count)
}

beforeEach(() => {
	fixture.root = mkdtempSync(path.join(tmpdir(), 'split-measure-'))
	vi.mocked(git_spawn.read).mockResolvedValue(`${fixture.root}\n`)
	vi.mocked(git_command.diff_numstat_since).mockResolvedValue('')
	vi.mocked(git_command.untracked_names).mockResolvedValue('')
	vi.mocked(change_base.resolved_through_merge).mockResolvedValue(TREE_BASE)
})

afterEach(async () => {
	await rm(fixture.root, { recursive: true, force: true })
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
		})
	})

	it('measures the tracked diff alone when nothing is untracked', async () => {
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue('3\t2\tscripts/a.ts')

		expect(await split_measure.read_branch()).toStrictEqual({
			files: 1,
			lines: 5,
			verdict: 'single',
		})
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
