import path from 'node:path'
import { project_checks } from '#scripts/gate/project-checks'
import { FAIL_EXIT_CODE, type BufferedProcessResult } from '#scripts/lib/buffered-process'
import { test_pinned_reach } from '#scripts/test/test-pinned-reach'
import { import_graph } from './import-graph'
import type { Dependency } from './import-graph-store'

// The import cycles of the whole tree, found once over the import graph (joshuafolkken/kit#8887).
// ESLint's `import/no-cycle` walked the chain again from every file it linted; this walks every file's
// direct imports once and reports each strongly connected component. It reads the runtime edges, as
// that rule does: an import that names only types joins no cycle.

const CHECK = 'import-cycles'

type Edges = ReadonlyMap<string, ReadonlyArray<string>>

interface Frame {
	file: string
	targets: ReadonlyArray<string>
	position: number
}

// The strongly connected component search, kept iterative so a deep import chain never overflows the call stack.
interface Search {
	edges: Edges
	index: Map<string, number>
	low: Map<string, number>
	stack: Array<string>
	on_stack: Set<string>
	frames: Array<Frame>
	cycles: Array<Array<string>>
}

function by_name(left: string, right: string): number {
	return left.localeCompare(right)
}

function rank(ranks: ReadonlyMap<string, number>, file: string): number {
	return ranks.get(file) ?? 0
}

function enter(search: Search, file: string): void {
	const order = search.index.size

	search.index.set(file, order)
	search.low.set(file, order)
	search.stack.push(file)
	search.on_stack.add(file)
	search.frames.push({ file, targets: search.edges.get(file) ?? [], position: 0 })
}

function lower(search: Search, file: string, value: number): void {
	search.low.set(file, Math.min(rank(search.low, file), value))
}

// A file whose search reached nothing older closes its component; one file alone is no cycle, and a
// file importing itself is `import/no-self-import`'s.
function close_component(search: Search, file: string): void {
	if (rank(search.low, file) !== rank(search.index, file)) return
	const component = search.stack.splice(search.stack.lastIndexOf(file))

	for (const member of component) search.on_stack.delete(member)
	if (component.length > 1) search.cycles.push(component.toSorted(by_name))
}

function leave(search: Search, frame: Frame): void {
	search.frames.pop()
	const parent = search.frames.at(-1)

	if (parent !== undefined) lower(search, parent.file, rank(search.low, frame.file))
	close_component(search, frame.file)
}

function step(search: Search, frame: Frame): void {
	const target = frame.targets[frame.position]

	frame.position += 1
	if (target === undefined) leave(search, frame)
	else if (!search.index.has(target)) enter(search, target)
	else if (search.on_stack.has(target)) lower(search, frame.file, rank(search.index, target))
}

function visit(search: Search, file: string): void {
	if (search.index.has(file)) return
	enter(search, file)

	for (let frame = search.frames.at(-1); frame !== undefined; frame = search.frames.at(-1)) {
		step(search, frame)
	}
}

// Each cycle as the sorted files it joins, the cycles ordered by their files.
function find(edges: Edges): Array<Array<string>> {
	const search: Search = {
		edges,
		index: new Map(),
		low: new Map(),
		stack: [],
		on_stack: new Set(),
		frames: [],
		cycles: [],
	}

	for (const file of edges.keys()) visit(search, file)

	return search.cycles.toSorted((left, right) => by_name(left.join('\n'), right.join('\n')))
}

// The project's own files each file imports; a package's never close a cycle back into the project.
function project_edges(dependencies: ReadonlyMap<string, ReadonlyArray<Dependency>>): Edges {
	return new Map(
		[...dependencies].map(([file, targets]) => [
			file,
			targets.filter((target) => !target.external).map((target) => target.file),
		]),
	)
}

// Each file of the cycle with the files of the cycle it imports: one of those imports has to go.
function describe_cycle(cycle: ReadonlyArray<string>, edges: Edges, root: string): string {
	const members = new Set(cycle)

	return cycle
		.map((file) => {
			const inside = (edges.get(file) ?? []).filter((target) => members.has(target))
			const names = inside.map((target) => path.relative(root, target))

			return `  ${path.relative(root, file)} → ${names.join(', ')}\n`
		})
		.join('')
}

// `elapsed_ms` is named so the check's cost stays visible beside the lint it left (joshuafolkken/kit#8887).
function report(
	cycles: ReadonlyArray<ReadonlyArray<string>>,
	edges: Edges,
	root: string,
	elapsed_ms: number,
): string {
	const files = `${String(edges.size)} files in ${String(Math.round(elapsed_ms))} ms`
	if (cycles.length === 0) return `josh ${CHECK}: no import cycle across ${files}\n`
	const described = cycles.map((cycle) => describe_cycle(cycle, edges, root))
	const heading = `${String(cycles.length)} import cycle(s) across ${files}`

	return `josh ${CHECK}: ${heading} — break one import in each:\n${described.join('\n')}`
}

function skipped(reason: string): BufferedProcessResult {
	return { output: `${project_checks.skip_notice(CHECK, reason)}\n`, exit_code: 0, elapsed_ms: 0 }
}

// Undefined where the graph cannot be built: no `typescript`, or no `tsconfig.json` at the root.
async function edges_of(root: string): Promise<Edges | undefined> {
	const graph = await import_graph.create(root)
	if (graph?.runtime_edges === undefined) return undefined

	return project_edges(graph.runtime_edges(await test_pinned_reach.code_universe()))
}

// The whole tree's cycles; `root` is the working directory, which the work tree is listed from.
async function run(root: string): Promise<BufferedProcessResult> {
	const started = performance.now()
	const reason = project_checks.eslint_skip_reason(root)
	if (reason !== undefined) return skipped(reason)
	const edges = await edges_of(root)
	if (edges === undefined) return skipped('no typescript or tsconfig.json at the root')
	const cycles = find(edges)
	const elapsed_ms = performance.now() - started

	return {
		output: report(cycles, edges, root, elapsed_ms),
		exit_code: cycles.length === 0 ? 0 : FAIL_EXIT_CODE,
		elapsed_ms,
	}
}

const import_cycles = { find, project_edges, report, run }

export { import_cycles }
