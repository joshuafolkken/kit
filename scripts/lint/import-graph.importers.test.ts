import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { import_graph, type ImportGraph } from './import-graph'

// joshuafolkken/kit#5368: `runtime_importers` walks the test runner's graph, which a type-only
// declaration leaves, while `importers` and `closure` keep the edge a type-aware reader needs.
const LEAF = 'leaf.ts'
const READER = 'reader.ts'
const TSCONFIG = JSON.stringify({
	compilerOptions: { module: 'esnext', moduleResolution: 'bundler', verbatimModuleSyntax: true },
	include: ['*.ts'],
})
const TYPE_IMPORT = "import type { Leaf } from './leaf'\n"
const BOTH = [LEAF, READER]
const RUNTIME: 'importers' | 'runtime_importers' = 'runtime_importers'

const roots: Array<string> = []

async function graph_with(reader: string): Promise<{ root: string; graph: ImportGraph }> {
	const created = mkdtempSync(path.join(tmpdir(), 'kit-import-graph-importers-'))
	const root = realpathSync(created)

	roots.push(root)
	writeFileSync(path.join(root, LEAF), 'export type Leaf = 1\nexport const x = 1\n')
	writeFileSync(path.join(root, READER), reader)
	writeFileSync(path.join(root, 'tsconfig.json'), TSCONFIG)
	const graph = await import_graph.create(root)
	if (graph === undefined) throw new Error('expected a graph for a tsconfig project')

	return { root, graph }
}

async function importers_of(reader: string, kind = RUNTIME): Promise<Array<string>> {
	const { root, graph } = await graph_with(reader)
	const universe = BOTH.map((name) => path.join(root, name))
	const reached = graph[kind]([path.join(root, LEAF)], universe)

	return [...reached]
		.map((file) => path.relative(root, file))
		.toSorted((left, right) => left.localeCompare(right))
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('import_graph.runtime_importers', () => {
	it('follows a value import', async () => {
		expect(await importers_of("import { x } from './leaf'\n")).toStrictEqual(BOTH)
	})

	it('leaves out a file reading the leaf only through `import type`', async () => {
		expect(await importers_of(TYPE_IMPORT)).toStrictEqual([LEAF])
	})

	it('leaves out an `export type … from` re-export', async () => {
		expect(await importers_of("export type { Leaf } from './leaf'\n")).toStrictEqual([LEAF])
	})

	it('keeps an `import { type A }`, a side-effect import under verbatimModuleSyntax', async () => {
		expect(await importers_of("import { type Leaf } from './leaf'\n")).toStrictEqual(BOTH)
	})

	it('keeps the edge when the leaf is also imported for a value', async () => {
		expect(await importers_of(`${TYPE_IMPORT}import { x } from './leaf'\n`)).toStrictEqual(BOTH)
	})
})

describe('import_graph — the readers of a type-only import', () => {
	it('keeps the file in `importers`, which can name what the leaf exports', async () => {
		expect(await importers_of(TYPE_IMPORT, 'importers')).toStrictEqual(BOTH)
	})

	it('keeps the leaf in `closure`, as the lint cache needs', async () => {
		const { root, graph } = await graph_with(TYPE_IMPORT)

		expect(graph.closure(path.join(root, READER))).toContain(path.join(root, LEAF))
	})
})
