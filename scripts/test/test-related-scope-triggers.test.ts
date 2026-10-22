import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReadMap } from './test-read-map'
import { related_scope, type ScopeRequest } from './test-related-scope'

// joshuafolkken/kit#4510: a full-suite scope carries every changed file that sent it there, so the
// lane ledger can count the fallbacks by the file rather than only by the kind.

const ROOT = path.resolve('/repo')
const SCRIPTS_DIRECTORY = 'scripts'
const SOURCE_FILE = path.join(SCRIPTS_DIRECTORY, 'thing.ts')
const PACKAGE_FILE = 'package.json'
const LOCK_FILE = 'pnpm-lock.yaml'
const NEW_DRAFT = path.join('drafts', 'added.md')
const OTHER_NEW_DRAFT = path.join('drafts', 'other.md')
const DOCUMENT_FILE = path.join('docs', 'thing.md')
const DOCUMENT_READER = path.join(SCRIPTS_DIRECTORY, 'docs-reader.ts')

const MAP: ReadMap = {
	version: 1,
	commit: 'abc',
	dirty: {},
	directories: ['docs', SCRIPTS_DIRECTORY],
	readers: { [DOCUMENT_FILE]: [DOCUMENT_READER] },
}

function at(file: string): string {
	return path.join(ROOT, file)
}

function scope_of(
	changed: ScopeRequest['changed'],
	since_map: ReadonlyArray<string> = [],
): ReturnType<typeof related_scope.resolve_scope> {
	return related_scope.resolve_scope({
		root: ROOT,
		changed,
		map: MAP,
		recorded: new Set(),
		is_present: () => true,
		since_map,
	})
}

describe('related_scope.resolve_scope — the files that sent it to the whole suite', () => {
	it('holds every changed file every test depends on, while the reason names the first', () => {
		const scope = scope_of([SOURCE_FILE, PACKAGE_FILE, LOCK_FILE])

		expect(scope.mode).toBe('all')
		expect(scope.files).toStrictEqual([at(PACKAGE_FILE), at(LOCK_FILE)])
		expect(scope.reason).toBe(`${PACKAGE_FILE} affects every test`)
	})

	it('holds every changed file no recorded test read', () => {
		const scope = scope_of([NEW_DRAFT, DOCUMENT_FILE, OTHER_NEW_DRAFT])

		expect(scope.mode).toBe('all')
		expect(scope.files).toStrictEqual([at(NEW_DRAFT), at(OTHER_NEW_DRAFT)])
	})

	it('leaves a file that joined only from the map’s tree out of the whole-suite triggers', () => {
		const scope = scope_of([SOURCE_FILE, PACKAGE_FILE, NEW_DRAFT], [PACKAGE_FILE, NEW_DRAFT])

		expect(scope.mode).toBe('related')
		expect(scope.files).toStrictEqual([at(SOURCE_FILE)])
	})

	it('still sends the run to the whole suite on a trigger this change moved', () => {
		const scope = scope_of([PACKAGE_FILE, LOCK_FILE, NEW_DRAFT], [LOCK_FILE, NEW_DRAFT])

		expect(scope.mode).toBe('all')
		expect(scope.files).toStrictEqual([at(PACKAGE_FILE)])
	})

	it('still runs the tests reading a file that joined only from the map’s tree', () => {
		const scope = scope_of([SOURCE_FILE, DOCUMENT_FILE], [DOCUMENT_FILE])

		expect(scope.files).toStrictEqual([at(SOURCE_FILE), at(DOCUMENT_READER)])
	})

	it('holds no file where no file sent it there', () => {
		expect(scope_of(undefined).files).toStrictEqual([])
		expect(scope_of([]).files).toStrictEqual([])
	})
})

// joshuafolkken/kit#4532: a code file only the map's tree differs by reaches vitest only when it names a
// file this change moved.
describe('related_scope.resolve_scope — a code file that joined only from the map’s tree', () => {
	const changed = [SOURCE_FILE, DOCUMENT_READER]

	it('is left out when it names no moved file', () => {
		expect(scope_of(changed, [DOCUMENT_READER]).files).toStrictEqual([at(SOURCE_FILE)])
	})

	it('is handed to vitest when it is a test file, whatever it names', () => {
		const test_file = path.join(SCRIPTS_DIRECTORY, 'thing.test.ts')

		expect(scope_of([SOURCE_FILE, test_file], [test_file]).files).toStrictEqual([
			at(SOURCE_FILE),
			at(test_file),
		])
	})

	it('is handed to vitest when it names a moved file', () => {
		const scope = related_scope.resolve_scope({
			root: ROOT,
			changed,
			map: MAP,
			recorded: new Set(),
			is_present: () => true,
			since_map: [DOCUMENT_READER],
			naming_moved: new Set([DOCUMENT_READER]),
		})

		expect(scope.files).toStrictEqual([at(SOURCE_FILE), at(DOCUMENT_READER)])
	})
})
