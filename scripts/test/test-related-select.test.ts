import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { test_pinned_logic } from './test-pinned-logic'
import type { ReachedTests } from './test-pinned-reach'
import type { RelatedScope } from './test-related-scope'
import { test_related_select, type Selection, type SelectReaders } from './test-related-select'
import type { SymbolSelection } from './test-symbol-select'

// joshuafolkken/kit#7976: whatever the change, `josh test:related` hands vitest at most the cap's test
// files — the changed tests, then the scope's own and direct importers, then the outer reach — and
// counts the rest as deferred to CI.

const { MAX_TEST_FILES } = test_pinned_logic
const PAST_CAP = 10
const CODE = 'src/hub.ts'
const DIRECT_TEST = 'src/zz-direct.test.ts'
const CHANGED_TEST = 'src/zzz-changed.test.ts'
const E2E_SPEC = 'e2e/flow.spec.ts'
const GONE_TEST = 'src/gone.test.ts'
const SINCE_MAP_CODE = 'src/since-map.ts'
const OUTER_TESTS = Array.from(
	{ length: MAX_TEST_FILES + PAST_CAP },
	(_, index) => `src/outer-${String(index).padStart(3, '0')}.test.ts`,
)
const PRESENT = [CODE, DIRECT_TEST, CHANGED_TEST, E2E_SPEC, ...OUTER_TESTS]
// Sorted by code point already: `outer-` before `zz-direct` before `zzz-changed`.
const ALL_TESTS = [...OUTER_TESTS, DIRECT_TEST, CHANGED_TEST]
const DEFERRED = ALL_TESTS.length - MAX_TEST_FILES
const NOTHING: Selection = { tests: [], deferred: 0, reach: [], method: 'import' }

function write_files(root: string): void {
	for (const file of PRESENT) {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
		writeFileSync(path.join(root, file), '')
	}
}

function absolute_of(root: string, files: ReadonlyArray<string>): Array<string> {
	return files.map((file) => path.join(root, file))
}

// `reached` is root-relative; undefined reads as no graph, and no `symbol` as no symbol reading.
function readers_of(
	root: string,
	reached: ReadonlyArray<string> | undefined,
	symbol?: SymbolSelection,
): SelectReaders {
	return {
		symbols: async () => symbol,
		reach: async (files): Promise<Array<ReachedTests> | undefined> =>
			reached === undefined
				? undefined
				: files.map((file) => ({ file, tests: absolute_of(root, reached) })),
		importers: async (_root, files) => new Map(files.map((file) => [file, [DIRECT_TEST]])),
		all_tests: async () => absolute_of(root, [...ALL_TESTS, E2E_SPEC, GONE_TEST]),
	}
}

function related_of(root: string, files: ReadonlyArray<string>): RelatedScope {
	return { mode: 'related', files: absolute_of(root, files), reason: '' }
}

async function select_in(
	root: string,
	scope: RelatedScope,
	changed: ReadonlyArray<string>,
	reached: ReadonlyArray<string> | undefined,
): Promise<Selection> {
	return await test_related_select.select(root, scope, changed, readers_of(root, reached))
}

// `CODE` changed, every test reached by its imports, and `symbol` the declaration users' reading.
async function select_by_users(
	root: string,
	scope: RelatedScope,
	symbol: SymbolSelection,
): Promise<Selection> {
	const readers = readers_of(root, ALL_TESTS, symbol)

	return await test_related_select.select(root, scope, [CODE], readers)
}

function open_fixture(): FixtureWorkspace {
	const fixture = git_fixture_workspace.open_workspace('test-related-select-')

	write_files(fixture.workspace)

	return fixture
}

describe('test_related_select.capped_layers', () => {
	it('keeps the layers in order, each by code point, a file in its first layer only', () => {
		const layers = [['b.test.ts'], ['d.test.ts', 'B.test.ts', 'b.test.ts'], ['a.test.ts']]

		expect(test_related_select.capped_layers(layers)).toEqual({
			tests: ['b.test.ts', 'B.test.ts', 'd.test.ts', 'a.test.ts'],
			deferred: 0,
		})
	})

	it('cuts at the cap and counts the rest as deferred', () => {
		const layers = [['c.test.ts'], ['b.test.ts', 'a.test.ts']]

		expect(test_related_select.capped_layers(layers, 2)).toEqual({
			tests: ['c.test.ts', 'a.test.ts'],
			deferred: 1,
		})
	})
})

describe('test_related_select.select past the cap', () => {
	let fixture: FixtureWorkspace

	beforeEach(() => {
		fixture = open_fixture()
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it.each([
		['a new file reaching past the cap', [CODE]],
		['a hub whose imports changed, synced with main', [CODE, 'src/synced.ts', 'README.md']],
	])('runs the cap for %s, direct importer first', async (_, changed) => {
		const root = fixture.workspace
		const selection = await select_in(root, related_of(root, [CODE]), changed, ALL_TESTS)

		expect(selection.tests).toHaveLength(MAX_TEST_FILES)
		expect(selection.tests.slice(0, 2)).toEqual([DIRECT_TEST, OUTER_TESTS[0]])
		expect(selection.deferred).toBe(DEFERRED)
		expect(selection.reach).toEqual([{ file: CODE, count: ALL_TESTS.length }])
	})

	it('runs a changed test before the direct importers and the outer reach', async () => {
		const root = fixture.workspace
		const changed = [CODE, CHANGED_TEST]
		const selection = await select_in(root, related_of(root, changed), changed, ALL_TESTS)

		expect(selection.tests.slice(0, 3)).toEqual([CHANGED_TEST, DIRECT_TEST, OUTER_TESTS[0]])
		expect(selection.deferred).toBe(DEFERRED)
	})

	it('runs every test it selects where they fit under the cap, deferring none', async () => {
		const root = fixture.workspace
		const reached = OUTER_TESTS.slice(0, 2)
		const selection = await select_in(root, related_of(root, [CODE]), [CODE], reached)

		expect(selection).toMatchObject({ tests: [DIRECT_TEST, ...reached], deferred: 0 })
	})
})

describe('test_related_select.select reaching every test', () => {
	let fixture: FixtureWorkspace

	beforeEach(() => {
		fixture = open_fixture()
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('runs every unit test by path for a scope fallen to the whole suite, capped', async () => {
		const scope: RelatedScope = { mode: 'all', files: [], reason: '' }
		const selection = await select_in(fixture.workspace, scope, [CODE], [])
		const rest = ALL_TESTS.filter((test) => test !== DIRECT_TEST)

		expect(selection.tests).toEqual([DIRECT_TEST, ...rest].slice(0, MAX_TEST_FILES))
		expect(selection.deferred).toBe(DEFERRED)
	})

	it('runs every unit test with no graph, leaving out the e2e suite and a file gone', async () => {
		const root = fixture.workspace
		const selection = await select_in(root, related_of(root, [CODE]), [CODE], undefined)

		expect(selection.tests).toHaveLength(MAX_TEST_FILES)
		expect(selection.tests).not.toContain(E2E_SPEC)
		expect(selection.tests).not.toContain(GONE_TEST)
		expect(selection.deferred).toBe(DEFERRED)
		expect(selection.reach).toEqual([])
	})

	it('selects nothing for a scope reaching no test', async () => {
		const scope: RelatedScope = { mode: 'none', files: [], reason: '' }

		expect(await select_in(fixture.workspace, scope, [CODE], ALL_TESTS)).toEqual({
			tests: [],
			deferred: 0,
			reach: [],
			method: 'import',
		})
	})
})

describe('test_related_select.select by declaration users', () => {
	let fixture: FixtureWorkspace

	beforeEach(() => {
		fixture = open_fixture()
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('runs the users of the changed declarations in place of the import layers', async () => {
		const root = fixture.workspace
		const tests = [OUTER_TESTS[1] ?? '']
		const symbol = { tests, reach: [{ file: CODE, count: 1 }], direct: tests }
		const selection = await select_by_users(root, related_of(root, [CODE]), symbol)

		expect(selection).toEqual({ tests, reach: symbol.reach, deferred: 0, method: 'symbol' })
	})

	it('still defers what the users select past the cap', async () => {
		const root = fixture.workspace
		const reach = [{ file: CODE, count: ALL_TESTS.length }]
		const symbol = { tests: ALL_TESTS, reach, direct: [] }
		const selection = await select_by_users(root, related_of(root, [CODE]), symbol)

		expect(selection).toMatchObject({ deferred: DEFERRED, method: 'symbol' })
	})

	it('reads the import layers for a scope fallen to the whole suite', async () => {
		const scope: RelatedScope = { mode: 'all', files: [], reason: '' }
		const symbol = { tests: [], reach: [], direct: [] }
		const selection = await select_by_users(fixture.workspace, scope, symbol)

		expect(selection.method).toBe('import')
		expect(selection.tests).toHaveLength(MAX_TEST_FILES)
	})
})

// The code files the declaration users were read from, `changed` the run's own change.
async function symbol_input(
	root: string,
	scope: RelatedScope,
	changed: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
	const read: Array<string> = []
	const symbol = { tests: [], reach: [], direct: [] }
	const readers: SelectReaders = {
		...readers_of(root, ALL_TESTS, symbol),
		symbols: async (_root, code) => {
			read.push(...code)

			return symbol
		},
	}

	await test_related_select.select(root, scope, changed, readers)

	return read
}

// joshuafolkken/kit#8090: a scope file the run did not change — a code file of the change since the
// map naming a moved file — is no declaration users' input.
describe('test_related_select.select — the declaration users’ input', () => {
	let fixture: FixtureWorkspace

	beforeEach(() => {
		fixture = open_fixture()
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('reads the run’s own changed code alone', async () => {
		const root = fixture.workspace
		const scope = related_of(root, [CODE, SINCE_MAP_CODE])

		expect(await symbol_input(root, scope, [CODE])).toEqual([CODE])
	})
})

// joshuafolkken/kit#8091: past the cap the direct users of a changed declaration run first.
describe('test_related_select.select by declaration users, cut by rank', () => {
	const reach = [{ file: CODE, count: ALL_TESTS.length }]
	let fixture: FixtureWorkspace

	beforeEach(() => {
		fixture = open_fixture()
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('keeps a direct user sorting last past the cap, the farther users cut first', async () => {
		const root = fixture.workspace
		const symbol = { tests: ALL_TESTS, reach, direct: [DIRECT_TEST] }
		const selection = await select_by_users(root, related_of(root, [CODE]), symbol)

		expect(selection.tests[0]).toBe(DIRECT_TEST)
		expect(selection.tests.slice(1)).toEqual(OUTER_TESTS.slice(0, MAX_TEST_FILES - 1))
		expect(selection.deferred).toBe(DEFERRED)
	})

	it('selects the same tests in path order within a rank, whatever their order', async () => {
		const root = fixture.workspace
		const scope = related_of(root, [CODE])
		const direct = [DIRECT_TEST, OUTER_TESTS[2] ?? '', OUTER_TESTS[1] ?? '']
		const first = await select_by_users(root, scope, { tests: ALL_TESTS, reach, direct })
		const reversed = { tests: ALL_TESTS.toReversed(), reach, direct: direct.toReversed() }
		const second = await select_by_users(root, scope, reversed)

		expect(first.tests.slice(0, direct.length)).toEqual(direct.toReversed())
		expect(second.tests).toEqual(first.tests)
	})
})

describe('test_related_select.scope_of', () => {
	const root = '/repo'
	const scope = related_of(root, [CODE])

	it('carries the selected tests, absolute', () => {
		const selection: Selection = { ...NOTHING, tests: [DIRECT_TEST] }

		expect(test_related_select.scope_of(root, scope, selection)).toEqual({
			...scope,
			tests: [path.join(root, DIRECT_TEST)],
		})
	})

	it('reaches no test where nothing was selected', () => {
		expect(test_related_select.scope_of(root, scope, NOTHING)).toEqual({
			mode: 'none',
			files: scope.files,
			reason: test_related_select.NO_TEST_REASON,
		})
	})

	it('keeps a scope reaching no test as it is', () => {
		const none: RelatedScope = { mode: 'none', files: [], reason: 'unmoved' }

		expect(test_related_select.scope_of(root, none, NOTHING)).toBe(none)
	})
})
