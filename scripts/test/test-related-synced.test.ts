import path from 'node:path'
import { import_graph, type ImportGraph } from '#scripts/lint/import-graph'
import { describe, expect, it, vi } from 'vitest'
import { test_pinned_reach } from './test-pinned-reach'
import type { ReadMap } from './test-read-map'
import { test_related_synced } from './test-related-synced'

// joshuafolkken/kit#4912: after a main sync, every test importing a synced module ran again, though
// main's CI had run them. Only the tests reaching the branch's own change too run now.

const ROOT = process.cwd()
// Real files, since a synced module the tree no longer holds is never left out.
const SYNCED_MODULE = path.join('scripts', 'gate', 'moved-paths.ts')
const BRANCH_MODULE = path.join('scripts', 'test', 'test-related.ts')
const MAIN_ONLY_TEST = path.join('scripts', 'gate', 'moved-paths.test.ts')
const SHARED_TEST = path.join('scripts', 'test', 'test-related.test.ts')
const BRANCH_ONLY_TEST = path.join('scripts', 'test', 'test-related-main.test.ts')
const SHARED_HELPER = path.join('scripts', 'gate', 'since-green.ts')
const BRANCH_DATA = path.join('docs', 'guide.md')
const DATA_READER = path.join('scripts', 'document', 'guide-reader.ts')
const COMPONENT = path.join('src', 'lib', 'Card.svelte')
const NOTHING_LEFT = { left: [], shared: [], meeting: [] }

// The files whose imports reach each file, the file itself included: the shared test reaches the
// synced module through a helper, and reads the branch's data file through a recorded reader.
const IMPORTERS: Record<string, Array<string>> = {
	[SYNCED_MODULE]: [SYNCED_MODULE, MAIN_ONLY_TEST, SHARED_HELPER, SHARED_TEST],
	[BRANCH_MODULE]: [BRANCH_MODULE, SHARED_TEST, BRANCH_ONLY_TEST],
	[DATA_READER]: [DATA_READER, SHARED_TEST],
}

function absolute(file: string): string {
	return path.join(ROOT, file)
}

function importers_of(files: ReadonlyArray<string>): ReadonlySet<string> {
	const relative = files.map((file) => path.relative(ROOT, file))
	const reached = relative.flatMap((file) => IMPORTERS[file] ?? [file])

	return new Set(reached.map((file) => absolute(file)))
}

const FAKE_GRAPH: ImportGraph = {
	closure: () => [],
	closure_hash: () => '',
	imports: () => [],
	importers: () => new Set(),
	runtime_importers: (files) => importers_of(files),
	strings: () => [],
}

const MAP: ReadMap = {
	version: 0,
	commit: 'f00dcafe',
	dirty: {},
	change: [],
	directories: [],
	readers: { [BRANCH_DATA]: [DATA_READER] },
}

type Split = ReturnType<typeof test_related_synced.split_with>

function split_of(main_only: ReadonlyArray<string>, own: ReadonlyArray<string>): Split {
	return test_related_synced.split_with(FAKE_GRAPH, {
		root: ROOT,
		main_only: main_only.map((file) => absolute(file)),
		own: own.map((file) => absolute(file)),
		universe: [],
	})
}

function with_graph(universe: ReadonlyArray<string> = []): void {
	const files = universe.map((file) => absolute(file))

	vi.spyOn(import_graph, 'create').mockResolvedValue(FAKE_GRAPH)
	vi.spyOn(test_pinned_reach, 'code_universe').mockResolvedValue(files)
}

async function split(branch: ReadonlyArray<string>): Promise<Split> {
	return await test_related_synced.split(ROOT, [SYNCED_MODULE], branch, MAP)
}

describe('test_related_synced.split_with', () => {
	it('leaves out a test reading only the synced module', () => {
		const result = split_of([SYNCED_MODULE], [BRANCH_MODULE])

		expect(result.left).toEqual([SYNCED_MODULE])
		expect(result.shared).not.toContain(MAIN_ONLY_TEST)
	})

	it('keeps a test reaching both the synced module and the branch change, through a helper', () => {
		expect(split_of([SYNCED_MODULE], [BRANCH_MODULE]).shared).toEqual([SHARED_TEST])
	})

	it('names only tests the branch change alone already reaches', () => {
		const { shared } = split_of([SYNCED_MODULE], [BRANCH_MODULE])

		expect(IMPORTERS[BRANCH_MODULE]).toEqual(expect.arrayContaining([...shared]))
	})

	// joshuafolkken/kit#4985: the lint settle reads the code between, which no test names.
	it('meets at a branch module importing the synced one, though no test reaches both', () => {
		const result = split_of([SYNCED_MODULE], [SHARED_HELPER])

		expect(result.meeting).toEqual([SHARED_HELPER])
		expect(result.shared).toEqual([])
	})

	it('keeps a branch test file that imports the synced module itself', () => {
		expect(split_of([SYNCED_MODULE], [MAIN_ONLY_TEST]).shared).toEqual([MAIN_ONLY_TEST])
	})
})

describe('test_related_synced.split — what it splits', () => {
	it('splits over the work tree with repository-root-relative results', async () => {
		with_graph()

		await expect(split([BRANCH_MODULE])).resolves.toEqual({
			left: [SYNCED_MODULE],
			shared: [SHARED_TEST],
			meeting: [SHARED_TEST],
		})
	})

	it('keeps a test reading a non-code file of the branch through a recorded reader', async () => {
		with_graph()

		await expect(split([BRANCH_DATA])).resolves.toEqual({
			left: [SYNCED_MODULE],
			shared: [SHARED_TEST],
			meeting: [SHARED_TEST],
		})
	})

	it.each([
		['one the branch changed too', SYNCED_MODULE],
		['not code', path.join('docs', 'other.md')],
		['gone from the tree', path.join('scripts', 'lib', 'deleted-module.ts')],
		['one every test depends on', 'vitest.config.ts'],
		['a component', COMPONENT],
	])('builds no graph for a synced file that is %s', async (_case, synced) => {
		const create = vi.spyOn(import_graph, 'create')

		await expect(
			test_related_synced.split(ROOT, [synced], [BRANCH_MODULE, SYNCED_MODULE], MAP),
		).resolves.toEqual(NOTHING_LEFT)
		expect(create).not.toHaveBeenCalled()
	})
})

describe('test_related_synced.split — where it leaves nothing out', () => {
	it.each([
		['the branch change cannot be read', undefined, MAP],
		['there is no test-read map', [BRANCH_MODULE], undefined],
		['the branch changed a file every test depends on', [BRANCH_MODULE, 'pnpm-lock.yaml'], MAP],
		['the branch changed a component', [COMPONENT], MAP],
	])('when %s', async (_case, branch, map) => {
		with_graph()

		await expect(test_related_synced.split(ROOT, [SYNCED_MODULE], branch, map)).resolves.toEqual(
			NOTHING_LEFT,
		)
	})

	it('when the work tree holds a component the graph cannot follow', async () => {
		with_graph([COMPONENT])

		await expect(split([BRANCH_MODULE])).resolves.toEqual(NOTHING_LEFT)
	})

	it('when building the graph fails', async () => {
		vi.spyOn(import_graph, 'create').mockRejectedValue(new Error('not a git repository'))

		await expect(split([BRANCH_MODULE])).resolves.toEqual(NOTHING_LEFT)
	})

	it('where no graph can be built', async () => {
		vi.spyOn(import_graph, 'create').mockResolvedValue(undefined)

		await expect(split([BRANCH_MODULE])).resolves.toEqual(NOTHING_LEFT)
	})
})
