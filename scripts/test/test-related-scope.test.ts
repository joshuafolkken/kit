import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { related_scope } from './test-related-scope'

// joshuafolkken/kit#1257: the narrowing is what decides whether a re-check runs 6,616 tests or 566,
// and the one way it may not fail is quietly — a set narrowed to nothing runs no test and reports
// success. Every branch that could produce that is asserted here.

const ROOT = path.resolve('/repo')

function at(...segments: ReadonlyArray<string>): string {
	return path.join(ROOT, ...segments)
}

const SOURCE_FILE = at('scripts', 'thing.ts')
const OTHER_SOURCE_FILE = at('scripts', 'other.ts')
const DOCUMENT_FILE = at('docs', 'thing.md')

// How many files the listing has to leave unnamed for the "and N more" line to be exercised.
const UNLISTED_FILE_COUNT = 2

function present(): boolean {
	return true
}

function absent(): boolean {
	return false
}

describe('related_scope.is_relatable', () => {
	it.each(['a.ts', 'a.tsx', 'a.mts', 'a.js', 'a.svelte'])('accepts %j', (file) => {
		expect(related_scope.is_relatable(file)).toBe(true)
	})

	it.each(['a.md', 'a.yaml', 'a.json', 'Makefile'])('rejects %j', (file) => {
		expect(related_scope.is_relatable(file)).toBe(false)
	})
})

describe('related_scope.select_related_files', () => {
	it('keeps the source files the tree still holds', () => {
		const selected = related_scope.select_related_files(
			[SOURCE_FILE, DOCUMENT_FILE, OTHER_SOURCE_FILE],
			present,
		)

		expect(selected).toEqual([SOURCE_FILE, OTHER_SOURCE_FILE])
	})

	it('drops a path the tree no longer holds', () => {
		expect(related_scope.select_related_files([SOURCE_FILE], absent)).toEqual([])
	})
})

describe('related_scope.resolve_scope', () => {
	it('narrows to the changed source files', () => {
		const scope = related_scope.resolve_scope([SOURCE_FILE, DOCUMENT_FILE], present)

		expect(scope.mode).toBe('related')
		expect(scope.files).toEqual([SOURCE_FILE])
	})

	it('falls back to the whole suite when the changed files could not be read', () => {
		const scope = related_scope.resolve_scope(undefined, present)

		expect(scope.mode).toBe('all')
		expect(scope.reason).toBe(related_scope.UNREADABLE_REASON)
	})

	it('falls back to the whole suite when nothing changed', () => {
		const scope = related_scope.resolve_scope([], present)

		expect(scope.mode).toBe('all')
		expect(scope.reason).toBe(related_scope.NOTHING_RELATABLE_REASON)
	})

	it('falls back to the whole suite when no changed file has a module', () => {
		const scope = related_scope.resolve_scope([DOCUMENT_FILE], present)

		expect(scope.mode).toBe('all')
		expect(scope.reason).toBe(related_scope.NOTHING_RELATABLE_REASON)
	})

	it('separates an unreadable change list from one that narrowed to nothing', () => {
		expect(related_scope.resolve_scope(undefined, present).reason).not.toBe(
			related_scope.resolve_scope([], present).reason,
		)
	})
})

describe('related_scope.describe_scope', () => {
	it('names each file the run was narrowed by, relative to the root', () => {
		const scope = related_scope.resolve_scope([SOURCE_FILE, OTHER_SOURCE_FILE], present)
		const description = related_scope.describe_scope(scope, ROOT)

		expect(description).toContain('2 changed file(s)')
		expect(description).toContain(path.join('scripts', 'thing.ts'))
		expect(description).toContain(path.join('scripts', 'other.ts'))
	})

	it('caps the listing and says how many it did not name', () => {
		const files = Array.from(
			{ length: related_scope.LISTED_FILE_LIMIT + UNLISTED_FILE_COUNT },
			(_unused, index) => at('scripts', `file-${String(index)}.ts`),
		)
		const description = related_scope.describe_scope(
			related_scope.resolve_scope(files, present),
			ROOT,
		)

		expect(description).toContain(`… and ${String(UNLISTED_FILE_COUNT)} more`)
	})

	it('says which fallback was taken instead of reporting a narrowed run', () => {
		const description = related_scope.describe_scope(
			related_scope.resolve_scope(undefined, present),
			ROOT,
		)

		expect(description).toContain(related_scope.UNREADABLE_REASON)
		expect(description).toContain('running the full unit suite instead')
	})
})

describe('related_scope.vitest_arguments', () => {
	it('runs the whole suite on the fallback', () => {
		const scope = related_scope.resolve_scope(undefined, present)

		expect(related_scope.vitest_arguments(scope)).toEqual(['run'])
	})

	it('runs vitest related, out of watch mode, on the narrowed set', () => {
		const scope = related_scope.resolve_scope([SOURCE_FILE], present)

		expect(related_scope.vitest_arguments(scope)).toEqual(['related', SOURCE_FILE, '--run'])
	})

	it('forwards extra flags on both branches', () => {
		const related = related_scope.resolve_scope([SOURCE_FILE], present)
		const all = related_scope.resolve_scope(undefined, present)

		expect(related_scope.vitest_arguments(related, ['--silent'])).toContain('--silent')
		expect(related_scope.vitest_arguments(all, ['--silent'])).toEqual(['run', '--silent'])
	})
})
