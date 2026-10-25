import { existsSync } from 'node:fs'
import path from 'node:path'
import { git_spawn } from '#scripts/git/git-spawn'
import { import_graph, type ImportGraph } from '#scripts/lint/import-graph'
import { test_declared_logic } from './test-declared-logic'
import { test_pinned_cache_logic } from './test-pinned-cache-logic'
import { related_scope } from './test-related-scope'
import { whole_suite_files } from './whole-suite-files'

// What one `josh test:pinned` verdict rests on, read off the import graph (joshuafolkken/kit#4873): the
// `basis` `test-pinned-cache-logic.ts` holds a verdict by past the tree-wide digests. The graph is built
// on the first basis asked for, so a rerun the tree-wide digests already hold builds none — unless a
// changed fixture asks `probed_files` for its reach.
//
// **Where no graph can be built (no `typescript`, no `tsconfig.json`) every basis is undefined**, and a
// verdict holds only by the tree-wide digests, as before.

const NUL = '\0'
const FIXTURE_MARK = '-fixture'

interface Reach {
	related: (file: string) => Promise<string | undefined>
	failed: (tests: ReadonlyArray<string>) => Promise<string | undefined>
}

// What a basis is read against: the base commit, each changed non-test path with its content's digest,
// and each test file's.
interface ReachInputs {
	commit: string
	code: ReadonlyArray<string>
	digests: ReadonlyMap<string, string>
	test_digests: ReadonlyMap<string, string>
}

interface GraphView {
	graph: ImportGraph
	universe: ReadonlyArray<string>
}

// Every file in the work tree, tracked or untracked but not ignored. `-z` lists a path as it is,
// where `core.quotePath` would quote a non-ASCII one.
async function work_tree_files(): Promise<Array<string>> {
	const listed = await git_spawn.read(['ls-files', '-coz', '--exclude-standard'])

	return listed.split(NUL).filter((file) => file !== '')
}

// The graph with every code file the work tree holds, as absolute paths the graph resolves to.
async function view_of(): Promise<GraphView | undefined> {
	const graph = await import_graph.create(process.cwd())
	if (graph === undefined) return undefined
	const files = await work_tree_files()
	const code = files.filter((file) => related_scope.is_relatable(file) && existsSync(file))

	return { graph, universe: code.map((file) => path.resolve(file)) }
}

// A code file nothing imports that is not a test: a config, a setup file or a CLI a test spawns.
function is_root(view: GraphView, file: string): boolean {
	const relative = path.relative(process.cwd(), file)
	if (test_declared_logic.is_test_file(relative)) return false

	return view.graph.importers([file], view.universe).size <= 1
}

// A changed path no import names a test's dependency on: a non-code file a test reads, one every test
// depends on without importing it (the vitest config, the setup files, the lock), or a code file a root
// reaches — the root itself or a module it imports, which a test spawning it runs past any closure.
function is_asset(view: GraphView, file: string): boolean {
	if (
		!related_scope.is_relatable(file) ||
		whole_suite_files.WHOLE_SUITE_FILES.has(path.normalize(file))
	) {
		return true
	}

	const reached = view.graph.importers([path.resolve(file)], view.universe)

	return [...reached].some((reader) => is_root(view, reader))
}

// The mark of the test-only modules `package.json`'s `files` keeps out of the published package.
function is_fixture(file: string): boolean {
	return path.basename(file).includes(FIXTURE_MARK)
}

// The changed files `josh test:pinned` probes (joshuafolkken/kit#4879): a fixture no root reaches only
// moves what its tests cover, so its hunks hold no runtime behavior a test could pin. One a root reaches is
// kept, and so is every fixture where no graph can be built; the graph is built only for a fixture.
async function probed_files(files: ReadonlyArray<string>): Promise<Array<string>> {
	if (files.every((file) => !is_fixture(file))) return [...files]
	const view = await view_of()
	if (view === undefined) return [...files]

	return files.filter((file) => !is_fixture(file) || is_asset(view, file))
}

function related_of(view: GraphView, file: string, inputs: ReachInputs): string {
	const reached = view.graph.importers([path.resolve(file)], view.universe)
	const tests = [...reached]
		.map((reader) => path.relative(process.cwd(), reader))
		.filter((reader) => test_declared_logic.is_test_file(reader))

	return test_pinned_cache_logic.related_basis(tests, inputs.test_digests)
}

// None where no failed test is named or one is gone: what such a red rests on, no graph names.
function failed_of(
	view: GraphView,
	tests: ReadonlyArray<string>,
	inputs: ReachInputs,
): string | undefined {
	if (tests.length === 0 || tests.some((test) => !inputs.test_digests.has(test))) return undefined
	const closures = tests.map((test) => [test, view.graph.closure_hash(path.resolve(test))] as const)
	const assets = inputs.code.filter((file) => is_asset(view, file))
	const change = test_pinned_cache_logic.change_of(inputs.commit, assets, inputs.digests)

	return test_pinned_cache_logic.red_basis(change, closures)
}

function create(inputs: ReachInputs): Reach {
	const held: { view?: Promise<GraphView | undefined> } = {}

	async function related(file: string): Promise<string | undefined> {
		held.view ??= view_of()
		const read = await held.view

		return read === undefined ? undefined : related_of(read, file, inputs)
	}

	async function failed(tests: ReadonlyArray<string>): Promise<string | undefined> {
		held.view ??= view_of()
		const read = await held.view

		return read === undefined ? undefined : failed_of(read, tests, inputs)
	}

	return { related, failed }
}

const test_pinned_reach = { create, probed_files, work_tree_files }

export type { Reach, ReachInputs }
export { test_pinned_reach }
