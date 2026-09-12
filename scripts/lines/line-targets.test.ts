import { describe, expect, it } from 'vitest'
import { line_targets } from './line-targets'

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
