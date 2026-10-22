import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { file_reader } from '#scripts/lib/read-file'
import { parse, stringify } from 'flatted'
import { import_graph, type ImportGraph } from './import-graph'

// eslint's content cache keys a verdict on the linted file's own content, so a file whose imports
// changed underneath it keeps answering from the cache: the error a type-aware rule would now report
// — an import that became `any`, read by `no-unsafe-assignment` — never reaches the report, and the
// type check does not report the `no-unsafe-*` rules either (joshuafolkken/kit#4415). CI restores
// the gate's cache file, so it answers the same stale green.
//
// So each cached entry also records what its verdict read: the hash of every file its imports reach
// (`import-graph.ts`). Before a cached run, an entry whose imports no longer hash the same is dropped,
// and eslint lints that file afresh; after it, the entries eslint wrote are given the hash taken
// before the run, which is the state of the files that run read. An entry with no hash — one an
// unguarded run wrote, or one from before this — is dropped as well, because nothing says what it
// read.
//
// The drop clears a stale red as well as a stale green: an import rule's report — `import/no-cycle`,
// `import-x/named` — is about another file too, and once that file changes the entry is linted
// afresh. Only imports are followed, so a rule that reads the files importing this one — a
// reverse-dependency rule such as `import/no-unused-modules`, a no-op under ESLint 10 — would go
// stale here. This is the one place cache staleness is decided; it replaced the cross-file re-read that
// once ran after a red cached run (joshuafolkken/kit#3641, #3667, #4407, #4420).
//
// The record rides inside eslint's own cache file, in the entry's `data` beside the results eslint
// keeps there, rather than a file of its own: it then travels wherever the cache file does — a lane's
// seed, CI's cache — and eslint replaces `data` whole whenever it lints the file again, so a hash can
// never outlive the verdict it was taken for. The file is `flat-cache`'s, serialized with `flatted`.

type CacheMeta = Record<string, unknown>

interface CacheEntry {
	key: string
	value: CacheMeta
}

type Hashes = ReadonlyMap<string, string>

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function is_entry(item: unknown): item is CacheEntry {
	if (!is_record(item)) return false
	const { key, value } = item

	return typeof key === 'string' && is_record(value)
}

function is_entries(value: unknown): value is Array<CacheEntry> {
	return Array.isArray(value) && value.every((item: unknown) => is_entry(item))
}

function parsed_or_undefined(content: string): unknown {
	try {
		return parse(content)
	} catch {
		return undefined
	}
}

// Undefined for a missing file and for one this cannot read as eslint writes it.
function read_entries(cache_file: string): Array<CacheEntry> | undefined {
	const content = file_reader.read_optional(cache_file)
	if (content === undefined) return undefined
	const parsed = parsed_or_undefined(content)

	return is_entries(parsed) ? parsed : undefined
}

// A cache file this cannot read — a corrupt one, or one another layout wrote into a cache lanes share —
// is removed before the run rather than left to eslint, so the run rebuilds it whole and every entry it
// writes carries a hash (joshuafolkken/kit#4497).
function read_or_discard(cache_file: string): Array<CacheEntry> {
	const entries = read_entries(cache_file)

	if (entries === undefined) rmSync(cache_file, { force: true })

	return entries ?? []
}

function write_entries(cache_file: string, entries: ReadonlyArray<CacheEntry>): void {
	writeFileSync(cache_file, stringify(entries))
}

function recorded_hash(entry: CacheEntry): string | undefined {
	const { data } = entry.value
	if (!is_record(data)) return undefined
	const { dependencies } = data

	return typeof dependencies === 'string' ? dependencies : undefined
}

// Drops every entry whose imports no longer hash as recorded, and answers the hashes it took.
function drop_stale(cache_file: string, graph: ImportGraph): Hashes {
	const entries = read_or_discard(cache_file)
	const hashes = new Map(entries.map((entry) => [entry.key, graph.closure_hash(entry.key)]))
	const kept = entries.filter((entry) => recorded_hash(entry) === hashes.get(entry.key))

	if (kept.length !== entries.length) write_entries(cache_file, kept)

	return hashes
}

// eslint writes `data` only for a file it linted, so an entry with `data` and no hash is one this run
// linted. A file the run linted for the first time had no hash taken before it, so it is taken now.
function record_entry(entry: CacheEntry, hashes: Hashes, graph: ImportGraph): boolean {
	const { data } = entry.value
	if (!is_record(data) || 'dependencies' in data) return false

	Object.assign(data, { dependencies: hashes.get(entry.key) ?? graph.closure_hash(entry.key) })

	return true
}

function record(cache_file: string, hashes: Hashes, graph: ImportGraph): void {
	const entries = read_entries(cache_file)
	if (entries === undefined) return
	const recorded = entries.filter((entry) => record_entry(entry, hashes, graph))

	if (recorded.length > 0) write_entries(cache_file, entries)
}

// Runs one cached eslint run between the drop and the record. A project without `typescript` or a `tsconfig.json` runs it as it was.
async function guard<T>(
	cache_file: string,
	run: () => Promise<T>,
	root: string = process.cwd(),
): Promise<T> {
	const graph = await import_graph.create(root)
	if (graph === undefined) return await run()
	const location = path.resolve(root, cache_file)
	const hashes = drop_stale(location, graph)
	const result = await run()

	record(location, hashes, graph)

	return result
}

const eslint_cache_dependencies = { guard }

export { eslint_cache_dependencies }
