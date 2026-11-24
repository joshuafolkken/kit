import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { import_cycles } from './import-cycles'
import { import_graph } from './import-graph'

// joshuafolkken/kit#8887: the import cycles of the whole tree, found once over the runtime import
// edges in place of the per-file `import/no-cycle`.
type Edges = ReadonlyMap<string, ReadonlyArray<string>>

function edges_of(entries: ReadonlyArray<readonly [string, ReadonlyArray<string>]>): Edges {
	return new Map(entries)
}

describe('import_cycles.find', () => {
	it('finds no cycle in a chain', () => {
		const edges = edges_of([
			['a', ['b']],
			['b', ['c']],
			['c', []],
		])

		expect(import_cycles.find(edges)).toEqual([])
	})

	it('finds a cycle of two files', () => {
		const edges = edges_of([
			['b', ['a']],
			['a', ['b']],
		])

		expect(import_cycles.find(edges)).toEqual([['a', 'b']])
	})

	it('finds a cycle of more files as one, beside the files that only reach it', () => {
		const edges = edges_of([
			['entry', ['a']],
			['a', ['b']],
			['b', ['c']],
			['c', ['a', 'leaf']],
			['leaf', []],
		])

		expect(import_cycles.find(edges)).toEqual([['a', 'b', 'c']])
	})
})

describe('import_cycles.find — what is no cycle, and the order', () => {
	it('leaves a file importing itself to import/no-self-import', () => {
		expect(import_cycles.find(edges_of([['a', ['a']]]))).toEqual([])
	})

	it('orders separate cycles by their files', () => {
		const edges = edges_of([
			['y', ['z']],
			['z', ['y']],
			['a', ['b']],
			['b', ['a']],
		])

		expect(import_cycles.find(edges)).toEqual([
			['a', 'b'],
			['y', 'z'],
		])
	})
})

describe('import_cycles.project_edges', () => {
	it('keeps the project files each file imports and drops the packages', () => {
		const dependencies = new Map([
			[
				'a',
				[
					{ file: 'b', external: false },
					{ file: 'node_modules/x/index.d.ts', external: true },
				],
			],
		])

		expect(import_cycles.project_edges(dependencies)).toEqual(new Map([['a', ['b']]]))
	})
})

const ROOT = '/project'

describe('import_cycles.report', () => {
	it('says no cycle was found across the files it read', () => {
		const edges = edges_of([[path.join(ROOT, 'a.ts'), []]])

		expect(import_cycles.report([], edges, ROOT, 12.4)).toBe(
			'josh import-cycles: no import cycle across 1 files in 12 ms\n',
		)
	})

	it('names each file of a cycle with the cycle files it imports', () => {
		const first = path.join(ROOT, 'a.ts')
		const second = path.join(ROOT, 'b.ts')
		const edges = edges_of([
			[first, [second]],
			[second, [first]],
		])

		const text = import_cycles.report([[first, second]], edges, ROOT, 0)

		expect(text).toContain('1 import cycle(s) across 2 files')
		expect(text).toContain('  a.ts → b.ts\n  b.ts → a.ts\n')
	})
})

const make_directory = temporary_directory()
// The specifiers `import/no-cycle` once followed through the TypeScript resolver (joshuafolkken/kit#3599):
// a package `imports` alias and a tsconfig `paths` alias, besides the extensionless relative one.
const PACKAGE_JSON = JSON.stringify({ type: 'module', imports: { '#lib/*': './lib/*.ts' } })
const TSCONFIG = JSON.stringify({
	compilerOptions: {
		module: 'esnext',
		moduleResolution: 'bundler',
		strict: true,
		paths: { '$lib/*': ['./lib/*'] },
	},
	include: ['**/*.ts'],
})

function write_project(files: Record<string, string>): string {
	const root = realpathSync(make_directory('kit-import-cycles-'))

	writeFileSync(path.join(root, 'package.json'), PACKAGE_JSON)
	writeFileSync(path.join(root, 'tsconfig.json'), TSCONFIG)
	mkdirSync(path.join(root, 'lib'))

	for (const [name, content] of Object.entries(files)) {
		writeFileSync(path.join(root, name), content)
	}

	return root
}

async function cycles_in(files: Record<string, string>): Promise<Array<Array<string>>> {
	const root = write_project(files)
	const graph = await import_graph.create(root)
	const universe = Object.keys(files).map((name) => path.join(root, name))
	const runtime = graph?.runtime_edges?.(universe) ?? new Map()

	return import_cycles
		.find(import_cycles.project_edges(runtime))
		.map((cycle) => cycle.map((file) => path.relative(root, file)))
}

describe('import_cycles over a real import graph', () => {
	it('finds a cycle a value import closes', async () => {
		const cycles = await cycles_in({
			'left.ts': "import { right } from './right'\n\nexport const left = right\n",
			'right.ts': "import { left } from './left'\n\nexport const right = (): number => left\n",
		})

		expect(cycles).toEqual([['left.ts', 'right.ts']])
	})

	it('finds no cycle a type-only import closes', async () => {
		const cycles = await cycles_in({
			'left.ts':
				"import { right } from './right'\n\nexport type Left = { right: number }\n" +
				'export const left = right\n',
			'right.ts':
				"import type { Left } from './left'\n\nexport const right = 1\n" +
				'export type Right = Left\n',
		})

		expect(cycles).toEqual([])
	})
})

describe('import_cycles over a real import graph — aliases and depth', () => {
	it('finds a cycle through a package imports alias', async () => {
		const cycles = await cycles_in({
			'lib/c.ts': "import { d } from '#lib/d'\n\nexport const c = d\n",
			'lib/d.ts': "import { c } from '#lib/c'\n\nexport const d = (): number => c\n",
		})

		expect(cycles).toEqual([['lib/c.ts', 'lib/d.ts']])
	})

	it('finds a cycle through a tsconfig paths alias', async () => {
		const cycles = await cycles_in({
			'lib/g.ts': "import { h } from '$lib/h'\n\nexport const g = h\n",
			'lib/h.ts': "import { g } from '$lib/g'\n\nexport const h = (): number => g\n",
		})

		expect(cycles).toEqual([['lib/g.ts', 'lib/h.ts']])
	})

	it('finds a cycle four imports deep', async () => {
		const cycles = await cycles_in({
			'deep-a.ts': "import { b } from './deep-b'\n\nexport const a = b\n",
			'deep-b.ts': "import { c } from './deep-c'\n\nexport const b = c\n",
			'deep-c.ts': "import { d } from './deep-d'\n\nexport const c = d\n",
			'deep-d.ts': "import { a } from './deep-a'\n\nexport const d = (): number => a\n",
		})

		expect(cycles).toEqual([['deep-a.ts', 'deep-b.ts', 'deep-c.ts', 'deep-d.ts']])
	})
})
