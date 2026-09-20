import { describe, expect, it } from 'vitest'
import { refactor_targets } from './refactor-targets'

const ROOT = '/repo'
const CHANGED_FILE = '/repo/a.ts'
const FALLBACK_FILE = '/repo/scripts/s.ts'
const SCRIPTS_A = '/repo/scripts/a.ts'
const SCRIPTS_C = '/repo/scripts/lib/c.ts'

describe('refactor_targets.select_scope', () => {
	it('uses the changed files when there are any', () => {
		expect(refactor_targets.select_scope([CHANGED_FILE], [FALLBACK_FILE])).toStrictEqual([
			CHANGED_FILE,
		])
	})

	it('falls back to the scripts files when nothing changed', () => {
		expect(refactor_targets.select_scope([], [FALLBACK_FILE])).toStrictEqual([FALLBACK_FILE])
	})
})

describe('refactor_targets.is_path_excluded', () => {
	it('excludes a demo directory and a demo-named file', () => {
		expect(refactor_targets.is_path_excluded('scripts/demo/x.ts')).toBe(true)
		expect(refactor_targets.is_path_excluded('src/lib/foo.demo.ts')).toBe(true)
	})

	it('excludes the story routes', () => {
		expect(refactor_targets.is_path_excluded('src/routes/stories/Foo.svelte')).toBe(true)
	})

	it('keeps an ordinary source path', () => {
		expect(refactor_targets.is_path_excluded('scripts/refactor/refactor-scan.ts')).toBe(false)
	})
})

describe('refactor_targets.has_ignore_marker', () => {
	it('opts a file out when the marker is at the top', () => {
		expect(refactor_targets.has_ignore_marker('/* @refactor-ignore */\nconst a = 1\n')).toBe(true)
	})

	it('tolerates leading whitespace before the marker', () => {
		expect(refactor_targets.has_ignore_marker('\n  /* @refactor-ignore */\n')).toBe(true)
	})

	it('does not opt out when the marker is not at the top', () => {
		expect(refactor_targets.has_ignore_marker('const a = 1\n/* @refactor-ignore */\n')).toBe(false)
	})
})

describe('refactor_targets.scripts_files', () => {
	it('keeps only files under the scripts directory', () => {
		const files = [SCRIPTS_A, '/repo/src/b.ts', SCRIPTS_C]

		expect(refactor_targets.scripts_files(ROOT, files)).toStrictEqual([SCRIPTS_A, SCRIPTS_C])
	})
})
