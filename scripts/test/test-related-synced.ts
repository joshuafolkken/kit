import { existsSync } from 'node:fs'
import path from 'node:path'
import { import_graph, type ImportGraph } from '#scripts/lint/import-graph'
import { test_declared_logic } from './test-declared-logic'
import { test_pinned_reach } from './test-pinned-reach'
import { test_read_map, type ReadMap } from './test-read-map'
import { related_scope } from './test-related-scope'
import { whole_suite_files } from './whole-suite-files'

// **A code module a main sync brought in reaches vitest only through a test this branch's change
// reaches too** (joshuafolkken/kit#4912). Handed to `vitest related` as a moved file, such a module ran
// every test importing it, and main's CI had already run those against it. The tests whose imports reach
// both the synced module and this branch's own change — a code file of it, or a module the test-read
// map records reading a non-code one — are where the two can meet, so they run; the rest are left to
// main's CI. Every one of them is a test the branch's own change reaches, so the narrowing never reads
// more than the whole branch does.
//
// **The import graph is TypeScript's, which drops an import it cannot resolve**, so only what it can
// follow is left out. Nothing is left out where no graph can be built, the branch change or the map
// cannot be read, the branch changed a file every test depends on, or the work tree holds a
// component TypeScript does not resolve; a synced module that is gone or is such a component stays a
// moved file. Each of those runs the tests importing it, as before. A synced module every test depends
// on is not split either: `test-related.ts` leaves it to main's CI unless this branch changed it too.

// `left` are the synced modules no longer handed to vitest, `shared` the tests that run in their place,
// `meeting` every file whose imports reach both — `shared` and the code between, which `josh ship`'s
// lint settle reads (joshuafolkken/kit#4985) — all repository-root-relative.
interface SyncedSplit {
	left: ReadonlyArray<string>
	shared: ReadonlyArray<string>
	meeting: ReadonlyArray<string>
}

// What the split is read from: the synced modules this branch did not change, the code of its own
// change, and every code file of the work tree, all absolute as the graph resolves them.
interface SplitInputs {
	root: string
	main_only: ReadonlyArray<string>
	own: ReadonlyArray<string>
	universe: ReadonlyArray<string>
}

const NOTHING_LEFT: SyncedSplit = { left: [], shared: [], meeting: [] }
const UNRESOLVED_EXTENSION = '.svelte'

function is_unresolved(file: string): boolean {
	return path.extname(file) === UNRESOLVED_EXTENSION
}

function is_beyond_graph(file: string): boolean {
	return whole_suite_files.WHOLE_SUITE_FILES.has(path.normalize(file)) || is_unresolved(file)
}

function is_vouched(root: string, file: string): boolean {
	if (!related_scope.is_relatable(file) || is_beyond_graph(file)) return false

	return existsSync(path.join(root, file))
}

// The branch's own change as the graph reads it: its code files and the recorded readers of its
// non-code ones. `undefined` where the graph cannot vouch for it.
function own_of(
	branch: ReadonlyArray<string> | undefined,
	map: ReadMap | undefined,
): ReadonlyArray<string> | undefined {
	if (branch === undefined || map === undefined) return undefined

	const data = branch.filter((file) => !related_scope.is_relatable(file))
	const readers = data.flatMap((file) => test_read_map.readers_of(map, file))
	const code = branch.filter((file) => related_scope.is_relatable(file))

	return branch.some((file) => is_beyond_graph(file)) ? undefined : [...code, ...readers]
}

function split_with(graph: ImportGraph, inputs: SplitInputs): SyncedSplit {
	const { root, main_only, own, universe } = inputs
	const from_branch = graph.importers(own, universe)
	const meeting = [...graph.importers(main_only, universe)]
		.filter((file) => from_branch.has(file))
		.map((file) => path.relative(root, file))
	const shared = meeting.filter((file) => test_declared_logic.is_test_file(file))

	return { left: main_only.map((file) => path.relative(root, file)), shared, meeting }
}

function absolute_in(root: string, files: ReadonlyArray<string>): Array<string> {
	return files.map((file) => path.join(root, file))
}

async function split_by_graph(
	root: string,
	main_only: ReadonlyArray<string>,
	own: ReadonlyArray<string>,
): Promise<SyncedSplit> {
	const graph = await import_graph.create(root)

	if (graph === undefined) return NOTHING_LEFT

	const universe = await test_pinned_reach.code_universe()

	if (universe.some((file) => is_unresolved(file))) return NOTHING_LEFT

	return split_with(graph, {
		root,
		main_only: absolute_in(root, main_only),
		own: absolute_in(root, own),
		universe,
	})
}

// The graph is built only when a synced module this branch did not change is there to split. A failure
// to build or walk it — git unreadable, a file gone mid-walk — leaves nothing out.
async function split(
	root: string,
	synced: ReadonlyArray<string>,
	branch: ReadonlyArray<string> | undefined,
	map: ReadMap | undefined,
): Promise<SyncedSplit> {
	const own = own_of(branch, map)
	const main_only = synced.filter((file) => !own?.includes(file) && is_vouched(root, file))

	if (own === undefined || main_only.length === 0) return NOTHING_LEFT

	try {
		return await split_by_graph(root, main_only, own)
	} catch {
		return NOTHING_LEFT
	}
}

const test_related_synced = { split, split_with }

export type { SyncedSplit }
export { test_related_synced }
