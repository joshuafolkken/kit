import { readFileSync } from 'node:fs'
import path from 'node:path'

// The scope expansion `prompts/refactoring.md` §4.3 used to describe in prose (joshuafolkken/kit#2180):
// from the seed files, follow imports both ways — the files a seed imports and the files that import a
// seed — for up to three stages, stopping as soon as a stage finds nothing new. Walking the import
// graph is exactly computable, so it is computed here rather than read and traced by hand.

// `import ... from '<spec>'` and `export ... from '<spec>'` both re-export from a specifier; the group
// captures it. `from` is matched as a word so an identifier ending in `from` is not mistaken for the
// keyword.
const FROM_PATTERN = /\bfrom[ \t]*['"]([^'"\n]+)['"]/gu
// A side-effect import carries no `from`: `import './register'`.
const BARE_IMPORT_PATTERN = /^[ \t]*import[ \t]+['"]([^'"\n]+)['"]/gmu
// The subpath import this package uses for cross-directory `scripts/` imports; `#scripts/x` resolves
// to `scripts/x`. Relative specifiers resolve against the importer's directory.
const SUBPATH_PREFIX = '#scripts/'
const SCRIPTS_DIR = 'scripts'
const RELATIVE_PREFIX = '.'
// A specifier omits its extension, so a resolved base is tried against the real files these suffixes
// would produce — a sibling module or a directory's index, in the order a resolver would.
const CANDIDATE_SUFFIXES: ReadonlyArray<string> = ['', '.ts', '.js', '/index.ts', '/index.js']
// §4.3: at most three stages, and a stage that adds nothing ends the walk early.
const MAX_STAGES = 3

type FileGraph = ReadonlyMap<string, ReadonlySet<string>>

function specifiers_of(source: string, pattern: RegExp): ReadonlyArray<string> {
	const matches = [...source.matchAll(pattern)]

	return matches.flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
}

function parse_imports(source: string): ReadonlyArray<string> {
	return [...specifiers_of(source, FROM_PATTERN), ...specifiers_of(source, BARE_IMPORT_PATTERN)]
}

// Where a local specifier points before extension resolution, or `undefined` for a package import
// this graph does not follow.
function specifier_base(spec: string, importer: string, root: string): string | undefined {
	if (spec.startsWith(SUBPATH_PREFIX)) {
		return path.resolve(root, SCRIPTS_DIR, spec.slice(SUBPATH_PREFIX.length))
	}

	if (spec.startsWith(RELATIVE_PREFIX)) return path.resolve(path.dirname(importer), spec)

	return undefined
}

function resolve_base(base: string, known: ReadonlySet<string>): string | undefined {
	return CANDIDATE_SUFFIXES.map((suffix) => `${base}${suffix}`).find((candidate) =>
		known.has(candidate),
	)
}

// A specifier resolved to a real file in the known set, or `undefined` when it is a package import or
// resolves to nothing this scan holds.
function resolve_spec(
	spec: string,
	importer: string,
	root: string,
	known: ReadonlySet<string>,
): string | undefined {
	const base = specifier_base(spec, importer, root)

	return base === undefined ? undefined : resolve_base(base, known)
}

function read_source(file: string): string {
	try {
		return readFileSync(file, 'utf8')
	} catch {
		return ''
	}
}

function file_imports(file: string, root: string, known: ReadonlySet<string>): ReadonlySet<string> {
	const specifiers = parse_imports(read_source(file))
	const resolved = specifiers.map((spec) => resolve_spec(spec, file, root, known))

	return new Set(resolved.filter((target): target is string => target !== undefined))
}

// File → the files it imports, over the whole universe so a seed's importers can be found by inversion.
function build_forward(files: ReadonlyArray<string>, root: string): FileGraph {
	const known = new Set(files)
	const forward = new Map<string, ReadonlySet<string>>()

	for (const file of files) forward.set(file, file_imports(file, root, known))

	return forward
}

function add_importer(reverse: Map<string, Set<string>>, target: string, importer: string): void {
	const importers = reverse.get(target) ?? new Set<string>()

	importers.add(importer)
	reverse.set(target, importers)
}

// File → the files that import it, so the walk can follow edges in both directions.
function invert(forward: FileGraph): FileGraph {
	const reverse = new Map<string, Set<string>>()

	for (const [file, targets] of forward) {
		for (const target of targets) add_importer(reverse, target, file)
	}

	return reverse
}

function neighbors_of(file: string, forward: FileGraph, reverse: FileGraph): ReadonlyArray<string> {
	return [...(forward.get(file) ?? []), ...(reverse.get(file) ?? [])]
}

interface Graphs {
	forward: FileGraph
	reverse: FileGraph
}

function fresh_neighbors(
	file: string,
	graphs: Graphs,
	included: ReadonlySet<string>,
): ReadonlyArray<string> {
	return neighbors_of(file, graphs.forward, graphs.reverse).filter(
		(neighbor) => !included.has(neighbor),
	)
}

function next_frontier(
	frontier: ReadonlyArray<string>,
	graphs: Graphs,
	included: ReadonlySet<string>,
): ReadonlyArray<string> {
	const found = new Set<string>()

	for (const file of frontier) {
		for (const neighbor of fresh_neighbors(file, graphs, included)) found.add(neighbor)
	}

	return [...found]
}

// The seed set plus every file reachable within `MAX_STAGES` import hops in either direction. A stage
// that adds nothing leaves the next `next_frontier` empty, so the walk converges within the cap.
function expand(
	seed: ReadonlyArray<string>,
	forward: FileGraph,
	reverse: FileGraph,
): ReadonlySet<string> {
	const included = new Set<string>(seed)
	let frontier: ReadonlyArray<string> = seed

	for (let stage = 0; stage < MAX_STAGES; stage++) {
		frontier = next_frontier(frontier, { forward, reverse }, included)

		for (const file of frontier) included.add(file)
	}

	return included
}

// The whole §4.3 walk: build the graph over the universe, then expand the seed within it.
function expand_scope(
	seed: ReadonlyArray<string>,
	universe: ReadonlyArray<string>,
	root: string,
): ReadonlySet<string> {
	const forward = build_forward(universe, root)

	return expand(seed, forward, invert(forward))
}

const import_graph = {
	build_forward,
	expand,
	expand_scope,
	invert,
	neighbors_of,
	parse_imports,
	resolve_spec,
	MAX_STAGES,
}

export type { FileGraph }
export { import_graph }
