import { describe, expect, it } from 'vitest'
import { import_graph, type FileGraph } from './import-graph'

const ROOT = '/repo'
const FILE_A = '/repo/scripts/a.ts'
const FILE_B = '/repo/scripts/b.ts'
const FILE_C = '/repo/scripts/lib/c.ts'
// One hop longer than `MAX_STAGES` reaches, so a capped walk and an uncapped one tell apart.
const LONG_CHAIN = ['/repo/0.ts', '/repo/1.ts', '/repo/2.ts', '/repo/3.ts', '/repo/4.ts']

function graph(entries: ReadonlyArray<readonly [string, ReadonlyArray<string>]>): FileGraph {
	return new Map(entries.map(([file, targets]) => [file, new Set(targets)]))
}

function chain_graph(files: ReadonlyArray<string>): FileGraph {
	return graph(files.map((file, index) => [file, files.slice(index + 1, index + 2)]))
}

describe('import_graph.parse_imports', () => {
	it('captures import, re-export, and bare specifiers', () => {
		const source =
			"import { a } from './x'\nexport { b } from '#scripts/y'\nimport './side-effect'\n"

		expect(import_graph.parse_imports(source)).toStrictEqual(['./x', '#scripts/y', './side-effect'])
	})

	it('does not read an identifier ending in from as the keyword', () => {
		expect(import_graph.parse_imports('const transform = 1\n')).toStrictEqual([])
	})
})

describe('import_graph.resolve_spec', () => {
	const known = new Set([FILE_A, FILE_B, FILE_C])

	it('resolves a #scripts subpath against the scripts directory', () => {
		expect(import_graph.resolve_spec('#scripts/lib/c', FILE_A, ROOT, known)).toBe(FILE_C)
	})

	it('resolves a relative specifier against the importer directory', () => {
		expect(import_graph.resolve_spec('./b', FILE_A, ROOT, known)).toBe(FILE_B)
	})

	it('returns undefined for a package import', () => {
		expect(import_graph.resolve_spec('zod', FILE_A, ROOT, known)).toBeUndefined()
	})

	it('returns undefined when nothing in the known set matches', () => {
		expect(import_graph.resolve_spec('./missing', FILE_A, ROOT, known)).toBeUndefined()
	})
})

describe('import_graph.invert', () => {
	it('turns import edges into importer edges', () => {
		const reverse = import_graph.invert(graph([[FILE_A, [FILE_B]]]))

		expect(reverse.get(FILE_B)).toStrictEqual(new Set([FILE_A]))
	})
})

describe('import_graph.expand', () => {
	it('follows import edges forward within the stage cap', () => {
		const forward = chain_graph([FILE_A, FILE_B, FILE_C])
		const expanded = import_graph.expand([FILE_A], forward, import_graph.invert(forward))

		expect(expanded).toStrictEqual(new Set([FILE_A, FILE_B, FILE_C]))
	})

	it('follows importer edges backward from the seed', () => {
		const forward = graph([[FILE_A, [FILE_C]]])
		const expanded = import_graph.expand([FILE_C], forward, import_graph.invert(forward))

		expect(expanded).toStrictEqual(new Set([FILE_C, FILE_A]))
	})

	it('stops at MAX_STAGES hops', () => {
		const forward = chain_graph(LONG_CHAIN)
		const expanded = import_graph.expand(
			[LONG_CHAIN[0] ?? ''],
			forward,
			import_graph.invert(forward),
		)

		expect(expanded.size).toBe(import_graph.MAX_STAGES + 1)
	})
})

describe('import_graph.reachable', () => {
	it('follows import edges forward past the stage cap', () => {
		const reached = import_graph.reachable(LONG_CHAIN[0] ?? '', chain_graph(LONG_CHAIN))

		expect(reached).toStrictEqual(new Set(LONG_CHAIN))
	})

	it('never follows importer edges backward', () => {
		const forward = graph([[FILE_A, [FILE_C]]])

		expect(import_graph.reachable(FILE_C, forward)).toStrictEqual(new Set([FILE_C]))
	})

	it('terminates on an import cycle', () => {
		const forward = graph([
			[FILE_A, [FILE_B]],
			[FILE_B, [FILE_A]],
		])

		expect(import_graph.reachable(FILE_A, forward)).toStrictEqual(new Set([FILE_A, FILE_B]))
	})
})
