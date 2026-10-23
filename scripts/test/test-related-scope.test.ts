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
const PROBED_FILE = path.join('data', 'kept.json')
const PROBER_FILE = path.join('scripts', 'data-prober.ts')
// Files added since the recorded tree: beside the unread note, beside a file a test read, in a
// directory the tree did not hold but a test read a path inside, and in one nothing inside was read from.
const NEW_UNREAD_FILE = path.join('notes', 'added.md')
const NEW_PROBED_FILE = path.join('data', 'added.json')
const NEW_DIRECTORY_FILE = path.join('drafts', 'added.md')
const ABSENT_DRAFT = path.join('drafts', 'absent.md')
const NEW_UNREAD_DIRECTORY_FILE = path.join('scratch', 'added.md')

// How many files the listing has to leave unnamed for the "and N more" line to be exercised.
const UNLISTED_FILE_COUNT = 2

const MAP: ReadMap = {
	version: 1,
	commit: 'abc',
	dirty: {},
	directories: ['data', 'docs', 'lib', 'notes', 'scripts'],
	readers: {
		[DOCUMENT_FILE]: [READER_FILE],
		[path.join('docs', '*')]: [WALKER_FILE],
		[DATA_SOURCE_FILE]: [DATA_READER_FILE],
		[PROBED_FILE]: [PROBER_FILE],
		[ABSENT_DRAFT]: [PROBER_FILE],
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
	return { root: ROOT, changed, map: MAP, recorded: new Set(), is_present: present, ...overrides }
}

// The recorded tree held the unread note, so its having no reader means no test reads it.
const HELD_UNREAD = new Set([UNREAD_FILE])

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
	it('narrows a changed document to the modules recorded reading it and listing its directory', () => {
		const scope = related_scope.resolve_scope(request([DOCUMENT_FILE, SOURCE_FILE]))

		expect(scope.mode).toBe('related')
		expect(scope.files).toEqual([at(SOURCE_FILE), at(READER_FILE), at(WALKER_FILE)])
	})

	it('reaches a document added since the map through the listing of its directory', () => {
		const scope = related_scope.resolve_scope(request([NEW_DOCUMENT_FILE]))

		expect(scope.files).toEqual([at(WALKER_FILE)])
	})

	it('falls back on a file added beside one a recorded test read, which may be read by name', () => {
		const scope = related_scope.resolve_scope(request([SOURCE_FILE, NEW_PROBED_FILE]))

		expect(scope.mode).toBe('all')
		expect(scope.reason).toBe(`${NEW_PROBED_FILE} is read by no recorded test`)
	})

	it('falls back on a file added in a directory the recorded tree did not hold, a test read inside', () => {
		const scope = related_scope.resolve_scope(
			request([NEW_DIRECTORY_FILE], { recorded: new Set([DOCUMENT_FILE]) }),
		)

		expect(scope.mode).toBe('all')
		expect(scope.reason).toContain(NEW_DIRECTORY_FILE)
	})

	// joshuafolkken/kit#4597: a branch's `.josh/metrics-accepted/<N>.json` lands in a directory the release
	// pruned from the recorded tree.
	it('runs no test for a file added in a new directory nothing inside was read from', () => {
		const scope = related_scope.resolve_scope(request([NEW_UNREAD_DIRECTORY_FILE]))

		expect(scope.mode).toBe('none')
		expect(scope.files).toStrictEqual([at(NEW_UNREAD_DIRECTORY_FILE)])
	})

	it('falls back to the whole suite on a non-code file when there is no map', () => {
		const scope = related_scope.resolve_scope(request([DOCUMENT_FILE], { map: undefined }))

		expect(scope.mode).toBe('all')
		expect(scope.reason).toContain(related_scope.NO_MAP_REASON)
	})
})

// joshuafolkken/kit#4073: a file the recorded tree held and no test read is one no test reads.
describe('related_scope.resolve_scope — files known to reach no test', () => {
	it('runs no test when every changed file is one the recorded tree held and no test read', () => {
		const scope = related_scope.resolve_scope(request([UNREAD_FILE], { recorded: HELD_UNREAD }))

		expect(scope.mode).toBe('none')
		expect(scope.files).toEqual([at(UNREAD_FILE)])
	})

	it('runs the readers of the rest when such a file changes beside them', () => {
		const scope = related_scope.resolve_scope(
			request([UNREAD_FILE, DOCUMENT_FILE], { recorded: HELD_UNREAD }),
		)

		expect(scope.mode).toBe('related')
		expect(scope.files).toEqual([at(READER_FILE), at(WALKER_FILE)])
	})

	it('falls back rather than running nothing when a changed module beside it has left the tree', () => {
		const scope = related_scope.resolve_scope(
			request([SOURCE_FILE, UNREAD_FILE], { recorded: HELD_UNREAD, is_present: absent }),
		)

		expect(scope.mode).toBe('all')
	})

	it('says it runs no test, why, and which files settled it', () => {
		const scope = related_scope.resolve_scope(request([UNREAD_FILE], { recorded: HELD_UNREAD }))
		const description = related_scope.describe_scope(scope, ROOT)

		expect(description).toContain('1 changed file(s) no test reads — running no tests')
		expect(description).toContain(UNREAD_FILE)
	})
})

// joshuafolkken/kit#4303: a lane's own new record — `.josh/observations/<N>.md` — lands in a
// directory the recorded tree held and no test read inside, and must not run the whole suite.
describe('related_scope.resolve_scope — files added to a directory no test reads inside', () => {
	it('runs no test for a file added since the recorded tree beside the unread note', () => {
		const scope = related_scope.resolve_scope(request([NEW_UNREAD_FILE]))

		expect(scope.mode).toBe('none')
		expect(scope.files).toEqual([at(NEW_UNREAD_FILE)])
	})

	it('says so with the same line a file the recorded tree held gets', () => {
		const description = related_scope.describe_scope(
			related_scope.resolve_scope(request([NEW_UNREAD_FILE])),
			ROOT,
		)

		expect(description).toBe(
			`${related_scope.COMMAND_LABEL}: 1 changed file(s) no test reads — running no tests.\n  - ${NEW_UNREAD_FILE}`,
		)
	})

	it('narrows to the changed code beside it rather than running the whole suite', () => {
		const scope = related_scope.resolve_scope(request([SOURCE_FILE, NEW_UNREAD_FILE]))

		expect(scope.mode).toBe('related')
		expect(scope.files).toEqual([at(SOURCE_FILE)])
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
		path.join('tools', 'test', 'unit-projects.ts'),
		path.join('tools', 'test', 'test-read-recorder.ts'),
		path.join('tools', 'test', 'test-read-capture.ts'),
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

// joshuafolkken/kit#4397: the gate ledger counts each full-suite fallback by a stable kind, never by
// the file its reason names.
function kind_of(changed: ScopeRequest['changed'], map?: ReadMap): string | undefined {
	const scope = related_scope.resolve_scope(request(changed, { map }))

	return related_scope.fallback_kind(
		`$ josh test:related\n${related_scope.describe_scope(scope, ROOT)}\n`,
	)
}

describe('related_scope.fallback_kind', () => {
	it.each([
		['unreadable', undefined, MAP],
		['nothing-relatable', [], MAP],
		['whole-suite-file', [path.join('scripts', 'test', 'unit-setup-files.ts')], MAP],
		['no-map', [DOCUMENT_FILE], undefined],
		['unrecorded-file', [NEW_DIRECTORY_FILE], MAP],
	])('reads the %s fallback off the line the run printed', (kind, changed, map) => {
		expect(kind_of(changed, map)).toBe(kind)
	})

	it('reads no fallback off a run that narrowed', () => {
		expect(kind_of([SOURCE_FILE], MAP)).toBeUndefined()
	})

	it('names a reason it has no kind for as other', () => {
		const scope = { mode: 'all' as const, files: [], reason: 'a reason not yet named' }

		expect(related_scope.fallback_kind(related_scope.describe_scope(scope, ROOT))).toBe('other')
	})
})

// joshuafolkken/kit#4457: the gate ledger tells the since-green no-op apart from a run that tested.
// joshuafolkken/kit#4465: the name a `josh test:related` run is recorded under in the lane ledger.
describe('related_scope.scope_kind', () => {
	it('names a narrowed or no-test scope by its mode', () => {
		expect(related_scope.scope_kind({ mode: 'related', files: [], reason: '' })).toBe('related')
		expect(related_scope.scope_kind({ mode: 'none', files: [], reason: '' })).toBe('none')
	})

	it('names a full-suite scope by the kind of its reason, the one fallback_kind reads', () => {
		const scope = { mode: 'all' as const, files: [], reason: related_scope.NO_MAP_REASON }

		expect(related_scope.scope_kind(scope)).toBe('no-map')
		expect(related_scope.fallback_kind(related_scope.describe_scope(scope, ROOT))).toBe('no-map')
	})
})

describe('related_scope.is_unmoved', () => {
	it('reads the since-green no-op off the line the run printed', () => {
		const scope = { mode: 'none' as const, files: [], reason: related_scope.UNMOVED_REASON }

		expect(related_scope.is_unmoved(`$ x\n${related_scope.describe_scope(scope, ROOT)}`)).toBe(true)
	})

	it.each([
		['a run that narrowed', [SOURCE_FILE]],
		['a run that narrowed to nothing', []],
		['a full-suite fallback', undefined],
	])('reads no no-op off %s', (_name, changed) => {
		const scope = related_scope.resolve_scope(request(changed))

		expect(related_scope.is_unmoved(related_scope.describe_scope(scope, ROOT))).toBe(false)
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
