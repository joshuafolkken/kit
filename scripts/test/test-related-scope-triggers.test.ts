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
	change: [],
	directories: ['docs', SCRIPTS_DIRECTORY],
	// A read inside `drafts`, which the tree did not hold, keeps a draft added there unrecorded.
	readers: {
		[DOCUMENT_FILE]: [DOCUMENT_READER],
		[path.join('drafts', 'absent.md')]: [DOCUMENT_READER],
	},
}

function at(file: string): string {
	return path.join(ROOT, file)
}

function scope_of(
	changed: ScopeRequest['changed'],
	since_map: ReadonlyArray<string> = [],
	naming_moved: ReadonlySet<string> = new Set(),
): ReturnType<typeof related_scope.resolve_scope> {
	return related_scope.resolve_scope({
		root: ROOT,
		changed,
		map: MAP,
		recorded: new Set(),
		is_present: () => true,
		since_map,
		naming_moved,
	})
}

// joshuafolkken/kit#4572: the worker share's bounds change often, so the vitest config imports only
// the run markers and a change to the bounds narrows like any module.
describe('related_scope.resolve_scope — the worker share', () => {
	const worker_share = path.join(SCRIPTS_DIRECTORY, 'test', 'unit-worker-share.ts')

	it('narrows a change to the worker share rather than running the whole suite', () => {
		expect(scope_of([worker_share])).toMatchObject({ mode: 'related', files: [at(worker_share)] })
	})
})

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

	it('is handed to vitest when it names a moved file', () => {
		const scope = scope_of(changed, [DOCUMENT_READER], new Set([DOCUMENT_READER]))

		expect(scope.files).toStrictEqual([at(SOURCE_FILE), at(DOCUMENT_READER)])
	})
})

// joshuafolkken/kit#4896: the map's tree lags main, so what it differs by — main's test files and the
// readers of main's non-code files — reaches vitest only where it touches this change.
describe('related_scope.resolve_scope — a test or data file that joined only from the map’s tree', () => {
	const test_file = path.join(SCRIPTS_DIRECTORY, 'thing.test.ts')

	it('leaves out a test file that names no moved file', () => {
		expect(scope_of([SOURCE_FILE, test_file], [test_file]).files).toStrictEqual([at(SOURCE_FILE)])
	})

	it('runs a test file added since the map that names a moved file', () => {
		const scope = scope_of([DOCUMENT_FILE, test_file], [test_file], new Set([test_file]))

		expect(scope.files).toStrictEqual([at(test_file), at(DOCUMENT_READER)])
	})

	it('leaves out the readers of a non-code file this change did not move', () => {
		const scope = scope_of([SOURCE_FILE, DOCUMENT_FILE], [DOCUMENT_FILE])

		expect(scope.files).toStrictEqual([at(SOURCE_FILE)])
	})

	it('still runs the readers of a non-code file this change moved', () => {
		expect(scope_of([DOCUMENT_FILE, test_file], [test_file]).files).toStrictEqual([
			at(DOCUMENT_READER),
		])
	})

	it('runs no test when the tree holds nothing of this change’s own', () => {
		const since_map = [test_file, DOCUMENT_FILE, DOCUMENT_READER, PACKAGE_FILE, NEW_DRAFT]

		expect(scope_of(since_map, since_map)).toMatchObject({ mode: 'none' })
	})
})

// joshuafolkken/kit#5001: rewriting one entry of the pure-project list ran the whole unit suite.
describe('related_scope.resolve_scope — an entries-only change of the pure-project list', () => {
	const pure_list = path.join('tools', 'test', 'pure-files.ts')
	const moved_entry = path.join(SCRIPTS_DIRECTORY, 'moved.test.ts')

	function pure_scope(
		pure_entries: ReadonlyArray<string> | undefined,
	): ReturnType<typeof related_scope.resolve_scope> {
		return related_scope.resolve_scope({
			root: ROOT,
			changed: [pure_list, SOURCE_FILE],
			map: MAP,
			recorded: new Set(),
			is_present: () => true,
			pure_entries,
		})
	}

	it('runs the moved entries and the list’s own tests rather than the whole suite', () => {
		expect(pure_scope([moved_entry])).toStrictEqual({
			mode: 'related',
			files: [
				at(SOURCE_FILE),
				at(path.join('tools', 'test', 'pure-files.test.ts')),
				at(path.join('tools', 'test', 'classify-isolation.test.ts')),
				at(moved_entry),
			],
			reason: '4 related file(s)',
		})
	})

	it('still runs the whole suite when the list moved beyond its entries', () => {
		expect(pure_scope(undefined)).toMatchObject({ mode: 'all', files: [at(pure_list)] })
	})
})
