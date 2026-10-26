import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { run_record_path } from '#scripts/josh/run-record-path'
import { atomic_write } from '#scripts/lib/atomic-write'
import { json_value } from '#scripts/lib/json-value'
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
// **One file per version** (joshuafolkken/kit#4423): a lane on an older kit writing its map leaves a
// newer lane's map in place, so a version bump no longer sends either to the whole suite.

interface ReadMap {
	version: number
	commit: string
	// The files that differed from `commit` when the map was recorded, each with the digest of its
	// content then (`input_fingerprint.of_files`), so one whose content has not moved since does not count as changed
	// (joshuafolkken/kit#4425).
	dirty: Record<string, string>
	// The recording checkout's change as a test reads it through git — the branch diff from the change
	// base plus the untracked files (`changed_paths.read_changed_paths`), committed or not
	// (joshuafolkken/kit#4734).
	change: Array<string>
	// The directories `commit` holds, so a directory new since then is told apart from one no test
	// read — the map's own keys cannot say which, since an unread directory has none.
	directories: Array<string>
	readers: ReadRecords
}

// Bumped whenever the shape, what a reader means or how `dirty` is digested changes, so a map an older
// kit wrote reads as no map at all and the next full run writes it afresh. 6: `dirty` is
// `input-fingerprint.ts`'s digest of every changed file (joshuafolkken/kit#4497). 7: `change`
// (joshuafolkken/kit#4734).
const MAP_VERSION = 7

const MAP_FILE_STEM = 'test-read-map'
const RECORD_EXTENSION = '.json'

// A map file of another version no lane has written for this long belongs to no kit still running,
// and is removed by the next write: one week.
const STALE_AFTER_MS = 604_800_000

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

function is_digest_record(value: unknown): value is Record<string, string> {
	if (!is_object(value) || Array.isArray(value)) return false

	return Object.values(value).every((digest) => typeof digest === 'string')
}

const FIELD_CHECKS: ReadonlyArray<[keyof ReadMap, (field: unknown) => boolean]> = [
	['version', (field) => field === MAP_VERSION],
	['commit', (field) => typeof field === 'string'],
	['dirty', is_digest_record],
	['change', is_string_array],
	['directories', is_string_array],
	['readers', is_read_records],
]

function is_read_map(value: unknown): value is ReadMap {
	if (!is_object(value)) return false

	return FIELD_CHECKS.every(([field, is_valid]) => is_valid(Reflect.get(value, field)))
}

// **The files whose content differs from the tree the map was recorded on** (joshuafolkken/kit#4425).
// `since` is every path that differs from `map.commit` now, and `current` the digest of every path
// that was dirty then. A path dirty then is changed only when its digest moved: counted by name, a
// lane's own change the map was recorded over read as changed on every later run, so a gate reused
// no green unit step whenever the lane held any code.
function changed_since_tree(
	map: ReadMap,
	since: ReadonlyArray<string>,
	current: Readonly<Record<string, string>>,
): Array<string> {
	const fresh = since.filter((file) => !Object.hasOwn(map.dirty, file))
	const moved = Object.entries(map.dirty)
		.filter(([file, digest]) => current[file] !== digest)
		.map(([file]) => file)

	return [...new Set([...fresh, ...moved])]
}

function parse_map(text: string): ReadMap | undefined {
	const value = json_value.parse_or_undefined(text)

	return is_read_map(value) ? value : undefined
}

function parse_records(text: string): ReadRecords {
	const value = json_value.parse_or_undefined(text)

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
//
// **A run record reaches only a test that read it by name** (joshuafolkken/kit#5001): a test listing or
// walking the root or `.josh/` reads the checkout around it, not the observation or accepted metrics
// a lane writes after its checks went green, so those keys would run every such test for bookkeeping.
function lookup_keys(relative: string, recorded: ReadonlySet<string>): Array<string> {
	if (run_record_path.is_run_record(relative)) return [relative]

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

// **A directory inside which no recorded test listed, walked or read any entry** (joshuafolkken/kit#4303).
// A file added to it since is one no test reads, as surely as one the tree already held there: a test
// that builds a path into it reads some file there, and one that enumerates it lists it, both of which
// leave a key whose directory is this one — a read is recorded before it runs, so a path absent then
// still leaves its key. **A directory new since the recording counts too** (joshuafolkken/kit#4597):
// a probe of it or a listing of its parent is one of `readers_of`'s keys, which the caller asks first.
// **A read of the recording tree's own change does not count** (joshuafolkken/kit#4734): a test that
// reads this checkout's change through git reads whatever file the recording lane held, so its own
// `.josh/metrics-accepted/<N>.json` marked that directory read and sent the next lane's to the whole
// suite. A listing or a walk of the directory, or a read of any other file there, still counts — except
// for a run record, which only a read of itself reaches (`lookup_keys`).
function in_unread_directory(map: ReadMap, relative: string): boolean {
	if (run_record_path.is_run_record(relative)) return true

	const directory = path.dirname(relative)
	const change = new Set(map.change)
	const keys = Object.keys(map.readers).filter((key) => !change.has(key))

	return keys.every((key) => path.dirname(key) !== directory)
}

function map_path(root: string, version: number = MAP_VERSION): string | undefined {
	const common = git_common_directory.repository(root)
	const name = `${MAP_FILE_STEM}.v${String(version)}${RECORD_EXTENSION}`

	return common === undefined
		? undefined
		: path.join(common, git_common_directory.STATE_DIRECTORY, name)
}

// Every version's map, the unversioned one kits before joshuafolkken/kit#4423 wrote included; a
// staging file ends in `.tmp`, not the extension.
function is_map_file(name: string): boolean {
	return name.startsWith(MAP_FILE_STEM) && name.endsWith(RECORD_EXTENSION)
}

// A file another lane's write pruned meanwhile has no stat, and is not this write's to remove.
function is_stale(file_path: string, now: number): boolean {
	const modified = statSync(file_path, { throwIfNoEntry: false })?.mtimeMs ?? now

	return now - modified > STALE_AFTER_MS
}

// The map just written is never stale, so it survives its own prune.
function prune_stale_maps(directory: string): void {
	const now = Date.now()
	const maps = readdirSync(directory)
		.filter((name) => is_map_file(name))
		.map((name) => path.join(directory, name))

	for (const file_path of maps) {
		if (is_stale(file_path, now)) rmSync(file_path, { force: true })
	}
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
// replaces it reads one whole map or the other. It lands in its own version's file.
function write_map(root: string, map: ReadMap): void {
	const file_path = map_path(root, map.version)

	if (file_path === undefined) return

	atomic_write.replace_file(file_path, JSON.stringify(map))
	prune_stale_maps(path.dirname(file_path))
}

// Every worker writes its own files into the run's directory; this reads them all back.
function collect_records(directory: string): Array<ReadRecords> {
	return readdirSync(directory)
		.filter((name) => name.endsWith(RECORD_EXTENSION))
		.map((name) => parse_records(read_text(path.join(directory, name)) ?? ''))
}

const test_read_map = {
	MAP_VERSION,
	changed_since_tree,
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
