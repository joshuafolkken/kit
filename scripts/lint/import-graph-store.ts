import { existsSync } from 'node:fs'
import path from 'node:path'
import { input_fingerprint } from '#scripts/gate/input-fingerprint'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { atomic_write } from '#scripts/lib/atomic-write'
import { json_value } from '#scripts/lib/json-value'
import { file_reader } from '#scripts/lib/read-file'
import { z } from 'zod'

// Each file's resolved imports, kept across runs (joshuafolkken/kit#7252). Resolving every import of
// the work tree is most of what `josh test:related` spends choosing its tests, and an unchanged file
// resolves as it did last time, so the resolution is stored keyed by the file's path and the digest of
// its content.
//
// **It lives in the git common directory**, shared by every lane of the clone, named from the root so
// one lane's entries rebase into another's checkout. A resolution reads more than its own file — the
// compiler options, the `package.json` imports, the installed packages — so the store answers only
// under the digest of those it was written with. Within one, an entry stops holding when a file it
// resolved to is gone, or when a file new to the store could take a resolution from one: `./a` once
// `a/index.ts`, a new `a.ts`. A file with an import that resolved to nothing is never stored, since the
// file that would answer it — `#scripts/lib/a` before `a.ts` exists — leaves no trace in its entry.

type EdgeName = 'all' | 'runtime'

interface Dependency {
	file: string
	external: boolean
}

type Memo = Map<string, ReadonlyArray<Dependency>>

// Bumped whenever the shape or what an entry means changes, so a store an older kit wrote reads as none.
const STORE_VERSION = 1
const STORE_NAME = `import-graph.v${String(STORE_VERSION)}.json`
// Read by every resolution besides the compiler options: the imports map and the installed packages.
const ENVIRONMENT_FILES = ['package.json', 'pnpm-lock.yaml']
// What a module specifier leaves off a file's name: its extension, a declaration's `.d` included.
const EXTENSION = /(?:\.d)?\.[^./]+$/u
const INDEX = 'index'

const stored_dependency = z.tuple([z.string(), z.boolean()])
const stored_file = z.object({
	hash: z.string(),
	all: z.array(stored_dependency).optional(),
	runtime: z.array(stored_dependency).optional(),
})
const stored_graph = z.object({
	version: z.literal(STORE_VERSION),
	environment: z.string(),
	files: z.record(z.string(), stored_file),
})

type StoredDependency = z.infer<typeof stored_dependency>
type StoredFile = z.infer<typeof stored_file>

interface EdgeStore {
	root: string
	environment: string
	// Undefined outside a git repository, where nothing is kept.
	file_path: string | undefined
	// Read on the first walk, so a graph that never walks the universe never reads the store.
	files: Record<string, StoredFile> | undefined
	seeded: Set<EdgeName>
	memo: Record<EdgeName, Memo>
	// The files whose resolution left an import unresolved, kept out of the store.
	unresolved: Record<EdgeName, Set<string>>
	content_hashes: Map<string, string>
}

interface Seeding {
	files: Record<string, StoredFile>
	added: ReadonlySet<string>
}

function store_path(root: string): string | undefined {
	const common = git_common_directory.repository(root)

	return common === undefined
		? undefined
		: path.join(common, git_common_directory.STATE_DIRECTORY, STORE_NAME)
}

function environment_of(root: string, config_files: ReadonlyArray<string>): string {
	const relatives = [...config_files.map((file) => path.relative(root, file)), ...ENVIRONMENT_FILES]
	const digests = Object.entries(input_fingerprint.of_files(root, relatives))

	return input_fingerprint.of_entries(digests.map(([file, digest]) => `${file}:${digest}`))
}

// `config_files` are the compiler options' files, `tsconfig.json` and every file it extends.
function open(root: string, config_files: ReadonlyArray<string>): EdgeStore {
	return {
		root,
		environment: environment_of(root, config_files),
		file_path: store_path(root),
		files: undefined,
		seeded: new Set(),
		memo: { all: new Map(), runtime: new Map() },
		unresolved: { all: new Set(), runtime: new Set() },
		content_hashes: new Map(),
	}
}

// A file's resolved imports memoized under `name`; `references` holds `undefined` for each import that
// resolved to nothing.
function remember(
	store: EdgeStore,
	name: EdgeName,
	file: string,
	references: ReadonlyArray<Dependency | undefined>,
): Array<Dependency> {
	const found = references.filter((dependency) => dependency !== undefined)

	if (found.length < references.length) store.unresolved[name].add(file)
	store.memo[name].set(file, found)

	return found
}

function content_hash(store: EdgeStore, file: string): string {
	const known = store.content_hashes.get(file)
	if (known !== undefined) return known
	const computed = input_fingerprint.of_file(file)

	store.content_hashes.set(file, computed)

	return computed
}

function read_files(store: EdgeStore): Record<string, StoredFile> {
	const text =
		store.file_path === undefined ? undefined : file_reader.read_if_readable(store.file_path)
	const stored = text === undefined ? undefined : json_value.parse_with(text, stored_graph)

	return stored?.environment === store.environment ? stored.files : {}
}

function files_of(store: EdgeStore): Record<string, StoredFile> {
	store.files ??= read_files(store)

	return store.files
}

// The name an import gives a file: `a/index.ts` and `a.ts` both answer `./a`.
function module_stem(file: string): string {
	const stem = file.replace(EXTENSION, '')

	return path.basename(stem) === INDEX ? path.dirname(stem) : stem
}

function added_stems(store: EdgeStore, universe: ReadonlyArray<string>): Set<string> {
	const files = files_of(store)
	const added = universe.filter((file) => !Object.hasOwn(files, path.relative(store.root, file)))

	return new Set(added.map((file) => module_stem(file)))
}

function rebased(store: EdgeStore, stored: ReadonlyArray<StoredDependency>): Array<Dependency> {
	return stored.map(([file, external]) => ({ file: path.join(store.root, file), external }))
}

// A stored resolution holds while its file is still there and no new file could answer its import.
function is_standing(dependency: Dependency, seeding: Seeding): boolean {
	return existsSync(dependency.file) && !seeding.added.has(module_stem(dependency.file))
}

function stored_edges(
	store: EdgeStore,
	name: EdgeName,
	file: string,
	seeding: Seeding,
): Array<Dependency> | undefined {
	const entry = seeding.files[path.relative(store.root, file)]
	const stored = entry?.hash === content_hash(store, file) ? entry[name] : undefined
	if (stored === undefined) return undefined
	const dependencies = rebased(store, stored)

	return dependencies.every((dependency) => is_standing(dependency, seeding))
		? dependencies
		: undefined
}

// The memo filled from the store for every file of `universe` whose entry still holds; the files it
// could not fill, which `keep` stores once the walk has resolved them. Once per kind of edge.
function seed(store: EdgeStore, name: EdgeName, universe: ReadonlyArray<string>): Array<string> {
	if (store.seeded.has(name)) return []
	store.seeded.add(name)
	const seeding = { files: files_of(store), added: added_stems(store, universe) }
	const memo = store.memo[name]

	return universe.filter((file) => {
		const stored = stored_edges(store, name, file, seeding)
		if (stored !== undefined && !memo.has(file)) memo.set(file, stored)

		return stored === undefined
	})
}

function entry_of(store: EdgeStore, name: EdgeName, file: string): StoredFile | undefined {
	const dependencies = store.memo[name].get(file)
	if (dependencies === undefined || store.unresolved[name].has(file)) return undefined
	const hash = content_hash(store, file)
	const known = files_of(store)[path.relative(store.root, file)]
	const entry: StoredFile = known?.hash === hash ? { ...known } : { hash }

	entry[name] = dependencies.map((dependency) => [
		path.relative(store.root, dependency.file),
		dependency.external,
	])

	return entry
}

// Entries for files this checkout no longer holds are dropped, so the store stays the size of a tree.
function write(store: EdgeStore, file_path: string): void {
	const files = Object.entries(files_of(store)).filter(([file]) =>
		existsSync(path.join(store.root, file)),
	)
	const graph = {
		version: STORE_VERSION,
		environment: store.environment,
		files: Object.fromEntries(files),
	}

	atomic_write.replace_file(file_path, JSON.stringify(graph))
}

// The resolutions `seed` left missing, stored once the walk has made them. A write replaces the store
// whole, so a lane reading it meanwhile reads one store or the other.
function keep(store: EdgeStore, name: EdgeName, missing: ReadonlyArray<string>): void {
	if (missing.length === 0 || store.file_path === undefined) return
	const files = files_of(store)

	for (const file of missing) {
		const entry = entry_of(store, name, file)
		if (entry !== undefined) files[path.relative(store.root, file)] = entry
	}

	write(store, store.file_path)
}

const import_graph_store = { content_hash, keep, open, remember, seed, store_path }

export type { Dependency, EdgeName, EdgeStore }
export { import_graph_store }
