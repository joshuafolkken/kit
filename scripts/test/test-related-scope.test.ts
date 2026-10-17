import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReadMap } from './test-read-map'
import { related_scope, type ScopeRequest } from './test-related-scope'

// joshuafolkken/kit#1257: the narrowing is what decides whether a re-check runs 6,616 tests or 566,
// and the one way it may not fail is quietly — a set narrowed to nothing runs no test and reports
// success. Every branch that could produce that is asserted here.
//
// joshuafolkken/kit#4065: the gate runs this narrowing in place of the whole suite, so a changed
// non-code file must reach every module recorded reading it, and fall back whenever the map cannot
// answer for it.

const ROOT = path.resolve('/repo')

function at(...segments: ReadonlyArray<string>): string {
	return path.join(ROOT, ...segments)
}

const SOURCE_FILE = path.join('scripts', 'thing.ts')
const OTHER_SOURCE_FILE = path.join('scripts', 'other.ts')
const DOCUMENT_FILE = path.join('docs', 'thing.md')
const NEW_DOCUMENT_FILE = path.join('docs', 'added.md')
const UNREAD_FILE = path.join('notes', 'thing.md')
const READER_FILE = path.join('scripts', 'docs-reader.ts')
const WALKER_FILE = path.join('scripts', 'docs-walker.ts')
const DATA_SOURCE_FILE = path.join('lib', 'read-as-data.ts')
const DATA_READER_FILE = path.join('lib', 'source-reader.test.ts')

// How many files the listing has to leave unnamed for the "and N more" line to be exercised.
const UNLISTED_FILE_COUNT = 2

const MAP: ReadMap = {
	version: 1,
	commit: 'abc',
	dirty: [],
	readers: {
		[DOCUMENT_FILE]: [READER_FILE],
		docs: [WALKER_FILE],
		[DATA_SOURCE_FILE]: [DATA_READER_FILE],
	},
}

function present(): boolean {
	return true
}

function absent(): boolean {
	return false
}

function request(
	changed: ScopeRequest['changed'],
	overrides: Partial<ScopeRequest> = {},
): ScopeRequest {
	return { root: ROOT, changed, map: MAP, is_present: present, ...overrides }
}

describe('related_scope.is_relatable', () => {
	it.each(['a.ts', 'a.tsx', 'a.mts', 'a.js', 'a.svelte'])('accepts %j', (file) => {
		expect(related_scope.is_relatable(file)).toBe(true)
	})

	it.each(['a.md', 'a.yaml', 'a.json', 'Makefile'])('rejects %j', (file) => {
		expect(related_scope.is_relatable(file)).toBe(false)
	})
})

describe('related_scope.resolve_scope — code files', () => {
	it('narrows to the changed source files, joined onto the root', () => {
		const scope = related_scope.resolve_scope(request([SOURCE_FILE, OTHER_SOURCE_FILE]))

		expect(scope.mode).toBe('related')
		expect(scope.files).toEqual([at(SOURCE_FILE), at(OTHER_SOURCE_FILE)])
	})

	it('needs no map for a change of code alone', () => {
		const scope = related_scope.resolve_scope(request([SOURCE_FILE], { map: undefined }))

		expect(scope.files).toEqual([at(SOURCE_FILE)])
	})

	it('adds the tests recorded reading a changed module through fs, which no import reaches', () => {
		const scope = related_scope.resolve_scope(request([DATA_SOURCE_FILE]))

		expect(scope.files).toEqual([at(DATA_SOURCE_FILE), at(DATA_READER_FILE)])
	})

	it('falls back to the whole suite when no changed file is still in the tree', () => {
		const scope = related_scope.resolve_scope(request([SOURCE_FILE], { is_present: absent }))

		expect(scope.mode).toBe('all')
		expect(scope.reason).toBe(related_scope.NOTHING_RELATABLE_REASON)
	})
})

describe('related_scope.resolve_scope — non-code files through the map', () => {
	it('narrows a changed document to the modules recorded reading it and the walks above it', () => {
		const scope = related_scope.resolve_scope(request([DOCUMENT_FILE, SOURCE_FILE]))

		expect(scope.mode).toBe('related')
		expect(scope.files).toEqual([at(SOURCE_FILE), at(READER_FILE), at(WALKER_FILE)])
	})

	it('reaches a document added since the map through the directory walk above it', () => {
		const scope = related_scope.resolve_scope(request([NEW_DOCUMENT_FILE]))

		expect(scope.files).toEqual([at(WALKER_FILE)])
	})

	it('falls back to the whole suite on a non-code file no recorded test read', () => {
		const scope = related_scope.resolve_scope(request([SOURCE_FILE, UNREAD_FILE]))

		expect(scope.mode).toBe('all')
		expect(scope.reason).toContain(UNREAD_FILE)
	})

	it('falls back to the whole suite on a non-code file when there is no map', () => {
		const scope = related_scope.resolve_scope(request([DOCUMENT_FILE], { map: undefined }))

		expect(scope.mode).toBe('all')
		expect(scope.reason).toContain(related_scope.NO_MAP_REASON)
	})
})

describe('related_scope.resolve_scope — the whole-suite fallbacks', () => {
	it('falls back when the changed files could not be read', () => {
		const scope = related_scope.resolve_scope(request(undefined))

		expect(scope.mode).toBe('all')
		expect(scope.reason).toBe(related_scope.UNREADABLE_REASON)
	})

	it('falls back when nothing changed', () => {
		const scope = related_scope.resolve_scope(request([]))

		expect(scope.mode).toBe('all')
		expect(scope.reason).toBe(related_scope.NOTHING_RELATABLE_REASON)
	})

	it.each([
		'package.json',
		'pnpm-lock.yaml',
		'vitest.config.ts',
		path.join('scripts', 'test', 'unit-projects.ts'),
		path.join('scripts', 'test', 'test-read-recorder.ts'),
		path.join('scripts', 'test', 'test-read-capture.ts'),
	])('falls back when %j changed, which every test depends on', (file) => {
		const scope = related_scope.resolve_scope(request([SOURCE_FILE, file]))

		expect(scope.mode).toBe('all')
		expect(scope.reason).toContain(file)
	})

	it('separates an unreadable change list from one that narrowed to nothing', () => {
		expect(related_scope.resolve_scope(request(undefined)).reason).not.toBe(
			related_scope.resolve_scope(request([])).reason,
		)
	})
})

describe('related_scope.describe_scope', () => {
	it('names each file the run was narrowed by, relative to the root', () => {
		const scope = related_scope.resolve_scope(request([SOURCE_FILE, OTHER_SOURCE_FILE]))
		const description = related_scope.describe_scope(scope, ROOT)

		expect(description).toContain('2 related file(s)')
		expect(description).toContain(SOURCE_FILE)
		expect(description).toContain(OTHER_SOURCE_FILE)
	})

	it('caps the listing and says how many it did not name', () => {
		const files = Array.from(
			{ length: related_scope.LISTED_FILE_LIMIT + UNLISTED_FILE_COUNT },
			(_unused, index) => path.join('scripts', `file-${String(index)}.ts`),
		)
		const description = related_scope.describe_scope(
			related_scope.resolve_scope(request(files)),
			ROOT,
		)

		expect(description).toContain(`… and ${String(UNLISTED_FILE_COUNT)} more`)
	})

	it('says which fallback was taken instead of reporting a narrowed run', () => {
		const description = related_scope.describe_scope(
			related_scope.resolve_scope(request(undefined)),
			ROOT,
		)

		expect(description).toContain(related_scope.UNREADABLE_REASON)
		expect(description).toContain('running the full unit suite instead')
	})
})

describe('related_scope.vitest_arguments', () => {
	it('runs the whole suite on the fallback', () => {
		const scope = related_scope.resolve_scope(request(undefined))

		expect(related_scope.vitest_arguments(scope)).toEqual(['run'])
	})

	it('runs vitest related, out of watch mode, on the narrowed set', () => {
		const scope = related_scope.resolve_scope(request([SOURCE_FILE]))

		expect(related_scope.vitest_arguments(scope)).toEqual(['related', at(SOURCE_FILE), '--run'])
	})

	it('forwards extra flags on both branches', () => {
		const related = related_scope.resolve_scope(request([SOURCE_FILE]))
		const all = related_scope.resolve_scope(request(undefined))

		expect(related_scope.vitest_arguments(related, ['--silent'])).toContain('--silent')
		expect(related_scope.vitest_arguments(all, ['--silent'])).toEqual(['run', '--silent'])
	})
})
