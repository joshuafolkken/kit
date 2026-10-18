import path from 'node:path'
import { fileURLToPath } from 'node:url'

// What one recorded read says, decided without touching `fs`: which repository path was read, and
// which module read it. `test-read-capture.ts`, armed by the `test-read-recorder.ts` setup file,
// feeds this from inside every unit worker; everything here is pure so the decisions are testable without patching `fs`.
//
// **The reader is the first repository frame on the stack, not the test file alone.** Under
// `isolate: false` a module that reads a document at load time is evaluated once per worker, so its
// read lands on whichever test imported it first. Recording the module as the reader lets
// `vitest related` widen the read to every test that imports it, on any worker. The test file is
// recorded beside it, because an async callback (a directory walk inside a dependency) leaves no
// repository frame at all.

type ReadRecords = Record<string, Array<string>>

// The worker setup file and the run that starts it agree on these two names and nothing else. They
// live here rather than beside the map because the setup file is loaded before any test's
// `vi.mock`: whatever it imports, no test can mock.
const RECORD_DIRECTORY_KEY = 'JOSH_TEST_READS_DIRECTORY'
const ROOT_KEY = 'JOSH_TEST_READS_ROOT'

const FILE_URL_PREFIX = 'file://'
const NODE_MODULES = 'node_modules'
const GIT_DIRECTORY = '.git'
const ROOT_ENTRY = '.'

// **What a read depends on is decided by the call, not by the path alone.** Reading or probing a
// path depends on that path; listing a directory depends on its direct entries; a recursive listing
// depends on everything beneath it. The two directory kinds are keyed with a glob-shaped suffix so
// the map keeps one shape: `scripts/*` is a listing of `scripts`, `scripts/**` a walk over it, and a
// listing of the root is `*`.
type ReadKind = 'path' | 'listing' | 'walk'

const LISTING_READS: ReadonlySet<string> = new Set([
	'readdir',
	'readdirSync',
	'opendir',
	'opendirSync',
])

const KIND_SUFFIX: Record<Exclude<ReadKind, 'path'>, string> = { listing: '*', walk: '**' }

function is_recursive(options: unknown): boolean {
	return (
		typeof options === 'object' && options !== null && Reflect.get(options, 'recursive') === true
	)
}

// The kind of read an `fs` call by this name makes, given its second argument.
function read_kind(name: string, options: unknown): ReadKind {
	if (!LISTING_READS.has(name)) return 'path'

	return is_recursive(options) ? 'walk' : 'listing'
}

function read_key(relative: string, kind: ReadKind): string {
	return kind === 'path' ? relative : path.join(relative, KIND_SUFFIX[kind])
}

// The file a call site's script name points at — an absolute path or a `file://` URL — or
// `undefined` for a `node:` internal or an evaluated string.
function script_path(script_name: string): string | undefined {
	if (script_name.startsWith(FILE_URL_PREFIX)) return fileURLToPath(script_name)

	return path.isAbsolute(script_name) ? script_name : undefined
}

function is_outside(relative: string): boolean {
	return relative.startsWith('..') || path.isAbsolute(relative)
}

function is_ignored(relative: string): boolean {
	const segments = relative.split(path.sep)

	return segments.includes(NODE_MODULES) || segments[0] === GIT_DIRECTORY
}

// A path relative to the root, or `undefined` when it lies outside it or inside a directory no test
// result depends on. The root itself is `.`.
function repository_path(root: string, file_path: string): string | undefined {
	const relative = path.relative(root, file_path)

	if (relative === '') return ROOT_ENTRY

	return is_outside(relative) || is_ignored(relative) ? undefined : relative
}

// The path an `fs` call names. A descriptor or a buffer names no path this map can key on.
function read_target(argument: unknown, cwd: string): string | undefined {
	if (typeof argument === 'string') return path.resolve(cwd, argument)
	if (argument instanceof URL) return fileURLToPath(argument)

	return undefined
}

interface ReaderQuery {
	root: string
	// The script name of every call site, innermost first.
	scripts: ReadonlyArray<string>
	// The recorder's own file, which is always the top frame and never the reader.
	recorder: string
}

function frame_reader(query: ReaderQuery, script_name: string): string | undefined {
	const file_path = script_path(script_name)

	if (file_path === undefined || file_path === query.recorder) return undefined

	const relative = repository_path(query.root, file_path)

	return relative === ROOT_ENTRY ? undefined : relative
}

function stack_reader(query: ReaderQuery): string | undefined {
	return query.scripts
		.map((script_name) => frame_reader(query, script_name))
		.find((reader) => reader !== undefined)
}

function add_reader(records: Map<string, Set<string>>, read_path: string, reader: string): void {
	const readers = records.get(read_path) ?? new Set<string>()

	readers.add(reader)
	records.set(read_path, readers)
}

function to_records(records: ReadonlyMap<string, ReadonlySet<string>>): ReadRecords {
	return Object.fromEntries([...records].map(([read_path, readers]) => [read_path, [...readers]]))
}

const test_read_trace = {
	RECORD_DIRECTORY_KEY,
	ROOT_ENTRY,
	ROOT_KEY,
	add_reader,
	read_key,
	read_kind,
	read_target,
	repository_path,
	script_path,
	stack_reader,
	to_records,
}

export type { ReadKind, ReaderQuery, ReadRecords }
export { test_read_trace }
