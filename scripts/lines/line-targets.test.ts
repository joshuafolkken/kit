import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))

const { git_spawn } = await import('#scripts/git/git-spawn')
const { line_targets } = await import('./line-targets')

const scratch = mkdtempSync(path.join(tmpdir(), 'line-targets-test-'))

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('line_targets.is_lint_target', () => {
	// The extension pre-filter keeps the eslint probe off non-source paths; every JS/TS variant and
	// Svelte are in, and documentation and data files are out.
	it('accepts source extensions and rejects the rest', () => {
		expect(line_targets.is_lint_target('scripts/a.ts')).toBe(true)
		expect(line_targets.is_lint_target('src/App.svelte')).toBe(true)
		expect(line_targets.is_lint_target('eslint/base.js')).toBe(true)
		expect(line_targets.is_lint_target('README.md')).toBe(false)
		expect(line_targets.is_lint_target('package.json')).toBe(false)
	})
})

describe('line_targets.split_names', () => {
	// `git ls-files -z` separates paths with NUL and never quotes them, so splitting on NUL and
	// dropping the empty trailing field is the whole parse.
	it('splits NUL-separated names and drops empties', () => {
		expect(line_targets.split_names('a.ts\0b.ts\0')).toEqual(['a.ts', 'b.ts'])
	})

	it('returns nothing for empty output', () => {
		expect(line_targets.split_names('')).toEqual([])
	})
})

describe('line_targets.lint_target_files', () => {
	// `--cached` still lists a file deleted from the working tree but not yet staged; handing that
	// path to eslint fails the whole metrics run, so only files still on disk are returned.
	it('drops a tracked path that is no longer on disk', async () => {
		writeFileSync(path.join(scratch, 'kept.ts'), '')
		vi.mocked(git_spawn.read).mockResolvedValue('kept.ts\0deleted.ts\0notes.md\0')

		const files = await line_targets.lint_target_files(scratch)

		expect(files).toEqual([path.join(scratch, 'kept.ts')])
	})
})
