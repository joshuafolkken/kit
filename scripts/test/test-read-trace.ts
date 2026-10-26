import path from 'node:path'
import { fileURLToPath } from 'node:url'

// What one recorded read says, decided without touching `fs`: which repository path was read, and
// which module read it. `test-read-capture.ts`, armed by the `test-read-recorder.ts` setup file,
// feeds this from inside every unit worker; everything here is pure so the decisions are testable without patching `fs`.
//
// **The reader is the outermost repository frame on the stack, not the test file alone.** Under
// `isolate: false` a module that reads a document at load time is evaluated once per worker, so its
// read lands on whichever test imported it first. Recording the module whose evaluation made the read
// lets `vitest related` widen the read to every test that imports it, on any worker. A read a test
// makes has the test outermost, so a shared helper it reads through — every test importing it — is
// never the reader (joshuafolkken/kit#4417). The test file is recorded beside it, because an async
// callback (a directory walk inside a dependency) leaves no repository frame at all.
//
// **Only a module's evaluation makes a module the reader** (joshuafolkken/kit#5033). A read a named
// function makes after an `await` has that function outermost, since the continuation drops the test
// that called it: `import-graph.ts` read some 3,700 paths that way, and `vitest related` widened each
// to every test importing it. Such a read belongs to the test running it, recorded beside, so an
// outermost frame with a function name records no module. A module's top-level code runs with no
// function name; so does an anonymous callback, which keeps the widening — the safe side.

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

// One call site: its script name, and the name of the function running there — empty for a module's
// top-level code.
interface CallFrame {
	script_name: string
	function_name: string
}

interface ReaderQuery {
	root: string
	// Every call site, innermost first.
	frames: ReadonlyArray<CallFrame>
	// The recorder's own file, which is always the top frame and never the reader.
	recorder: string
}

function frame_reader(query: ReaderQuery, frame: CallFrame): string | undefined {
	const file_path = script_path(frame.script_name)

	if (file_path === undefined || file_path === query.recorder) return undefined

	const relative = repository_path(query.root, file_path)

	return relative === ROOT_ENTRY ? undefined : relative
}

function stack_reader(query: ReaderQuery): string | undefined {
	const outermost = query.frames.findLast((frame) => frame_reader(query, frame) !== undefined)

	if (outermost?.function_name !== '') return undefined

	return frame_reader(query, outermost)
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

export type { CallFrame, ReadKind, ReaderQuery, ReadRecords }
export { test_read_trace }
