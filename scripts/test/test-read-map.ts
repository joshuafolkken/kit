import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { test_read_trace, type ReadRecords } from './test-read-trace'

// The test-read map: for every repository path a full unit run read, the modules that read it.
// `josh test:related` resolves a changed non-code file through it to the code files `vitest related`
// can walk, so a changed document runs the tests that read it rather than the whole suite.
//
// **The map is valid against the tree it was recorded on, and only that tree.** It records the
// commit and the files that differed from it, so the change a narrowing reads is the change since
// then. A tree whose own code changed what it reads has changed that code, and `vitest related`
// runs the tests importing it. **It lives in the git common directory**, which every lane worktree of
// one clone shares along with the commits it names, so one lane's full run narrows the next lane's.

interface ReadMap {
	version: number
	commit: string
	// The files that differed from `commit` when the map was recorded, which count as changed for
	// every narrowing read against it.
	dirty: Array<string>
	// The directories `commit` holds, so a directory new since then is told apart from one no test
	// read — the map's own keys cannot say which, since an unread directory has none.
	directories: Array<string>
	readers: ReadRecords
}

// Bumped whenever the shape or what a reader means changes, so a map an older kit wrote reads as no
// map at all.
const MAP_VERSION = 4

const MAP_DIRECTORY = 'josh'
const MAP_FILE = 'test-read-map.json'
const RECORD_EXTENSION = '.json'

type ReadPair = [string, string]

function record_pairs(record: ReadRecords): Array<ReadPair> {
	return Object.entries(record).flatMap(([read_path, readers]) =>
		readers.map((reader): ReadPair => [read_path, reader]),
	)
}

function merge_records(records: ReadonlyArray<ReadRecords>): ReadRecords {
	const merged = new Map<string, Set<string>>()
	const pairs = records.flatMap((record) => record_pairs(record))

	for (const [read_path, reader] of pairs) {
		test_read_trace.add_reader(merged, read_path, reader)
	}

	return test_read_trace.to_records(merged)
}

function is_object(value: unknown): value is object {
	return typeof value === 'object' && value !== null
}

function is_string_array(value: unknown): value is Array<string> {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function is_read_records(value: unknown): value is ReadRecords {
	return is_object(value) && Object.values(value).every(is_string_array)
}

const PATH_LIST_FIELDS = ['dirty', 'directories'] as const

function is_read_map(value: unknown): value is ReadMap {
	if (!is_object(value)) return false

	return (
		Reflect.get(value, 'version') === MAP_VERSION &&
		typeof Reflect.get(value, 'commit') === 'string' &&
		PATH_LIST_FIELDS.every((field) => is_string_array(Reflect.get(value, field))) &&
		is_read_records(Reflect.get(value, 'readers'))
	)
}

function parse_json(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

function parse_map(text: string): ReadMap | undefined {
	const value = parse_json(text)

	return is_read_map(value) ? value : undefined
}

function parse_records(text: string): ReadRecords {
	const value = parse_json(text)

	return is_read_records(value) ? value : {}
}

// Innermost first, ending at the root `.`.
function directories_above(relative: string): Array<string> {
	const parent = path.dirname(relative)

	if (parent === relative) return []

	return [parent, ...directories_above(parent)]
}

// The directories on the file's path the recorded commit did not hold, innermost first. The root
// always existed.
function created_directories(
	directories: ReadonlyArray<string>,
	recorded: ReadonlySet<string>,
): Array<string> {
	return directories.filter(
		(directory) => directory !== test_read_trace.ROOT_ENTRY && !recorded.has(directory),
	)
}

// A changed file is read by whoever read it, listed its own directory or walked any directory above
// it. A directory new since the recording is also a new entry in the listing above it and a probe of
// it that now answers differently; a directory that already existed reads the same to both, whatever
// changed deeper down.
function lookup_keys(relative: string, recorded: ReadonlySet<string>): Array<string> {
	const directories = directories_above(relative)
	const created = created_directories(directories, recorded)
	const listed = [
		directories[0] ?? test_read_trace.ROOT_ENTRY,
		...created.map((directory) => path.dirname(directory)),
	]

	return [
		relative,
		...created,
		...listed.map((directory) => test_read_trace.read_key(directory, 'listing')),
		...directories.map((directory) => test_read_trace.read_key(directory, 'walk')),
	]
}

function readers_of(map: ReadMap, relative: string): Array<string> {
	const keys = lookup_keys(relative, new Set(map.directories))

	return [...new Set(keys.flatMap((key) => map.readers[key] ?? []))]
}

// **A directory the recorded tree held, inside which no recorded test listed, walked or read any
// entry** (joshuafolkken/kit#4303). A file added to it since is one no test reads, as surely as one
// the tree already held there: a test that builds a path into it reads some file there, and one that
// enumerates it lists it, both of which leave a key whose directory is this one.
function in_unread_directory(map: ReadMap, relative: string): boolean {
	const directory = path.dirname(relative)

	if (!map.directories.includes(directory)) return false

	return Object.keys(map.readers).every((key) => path.dirname(key) !== directory)
}

function map_path(root: string): string | undefined {
	const common = git_common_directory.repository(root)

	return common === undefined ? undefined : path.join(common, MAP_DIRECTORY, MAP_FILE)
}

function read_text(file_path: string): string | undefined {
	try {
		return readFileSync(file_path, 'utf8')
	} catch {
		return undefined
	}
}

function read_map(root: string): ReadMap | undefined {
	const file_path = map_path(root)
	const text = file_path === undefined ? undefined : read_text(file_path)

	return text === undefined ? undefined : parse_map(text)
}

// Written beside the target and renamed over it, so a lane reading the map while another lane
// replaces it reads one whole map or the other.
function write_map(root: string, map: ReadMap): void {
	const file_path = map_path(root)

	if (file_path === undefined) return

	const staging = `${file_path}.${String(process.pid)}`

	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(staging, JSON.stringify(map))
	renameSync(staging, file_path)
}

// Every worker writes its own files into the run's directory; this reads them all back.
function collect_records(directory: string): Array<ReadRecords> {
	return readdirSync(directory)
		.filter((name) => name.endsWith(RECORD_EXTENSION))
		.map((name) => parse_records(read_text(path.join(directory, name)) ?? ''))
}

const test_read_map = {
	MAP_VERSION,
	collect_records,
	in_unread_directory,
	map_path,
	merge_records,
	parse_map,
	read_map,
	readers_of,
	write_map,
}

export type { ReadMap }
export { test_read_map }
