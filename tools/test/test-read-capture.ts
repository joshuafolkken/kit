import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCallSites } from 'node:util'
import { threadId } from 'node:worker_threads'
import { test_read_trace, type CallFrame, type ReadKind } from '#scripts/test/test-read-trace'
import { afterAll, expect } from 'vitest'

// What the worker setup file `test-read-recorder.ts` arms: recording which repository paths each test
// reads, for the test-read map (`test-read-map.ts`). Kept apart from the setup file so the recording
// can be tested without the side effect of arming it. **Arming does nothing unless the run that
// started vitest asked for a recording**
// — `josh test:unit` over the whole suite sets the two variables; a narrowed, sharded or filtered run
// does not, so the patch below never touches it.
//
// About 220 test files call `readFileSync` / `readFile` directly and about 42 walk a directory, so no
// static reading can name what a test depends on. Wrapping the reading half of `fs` in the worker
// sees every read a test makes in its own process, whichever module makes it. A read a test hands to
// a child process is not seen: a file only such a child reads resolves to whoever listed its
// directory or walked one above it, rather than to the test that depends on it, so the narrowing can
// miss that test, and CI's whole-suite run is what catches it.

interface RecorderState {
	root: string
	directory: string
	records: Map<string, Set<string>>
	flushes: number
}

// The worker keeps one patch and one record however many test files it runs: under
// `isolate: false` this file is evaluated again for every test file, and a second patch would wrap
// the first.
const STATE_KEY = Symbol.for('josh.test-read-recorder')

// Deep enough to climb out of a dependency's directory walk back to the repository module that
// started it.
const STACK_DEPTH = 64

const RECORDER = fileURLToPath(import.meta.url)

// Every call here takes the path it reads as its first argument, and a directory listing takes its
// options — `recursive` among them — as its second.
const SYNC_READS = [
	'readFileSync',
	'readdirSync',
	'existsSync',
	'statSync',
	'lstatSync',
	'accessSync',
	'opendirSync',
]
const ASYNC_READS = ['readFile', 'readdir', 'stat', 'lstat', 'access', 'opendir']

function caller_frames(): Array<CallFrame> {
	return getCallSites(STACK_DEPTH).map((site) => ({
		script_name: site.scriptName,
		function_name: site.functionName,
	}))
}

function current_test(root: string): string | undefined {
	const { testPath: test_path } = expect.getState()

	return test_path === undefined ? undefined : test_read_trace.repository_path(root, test_path)
}

function call_readers(root: string): Array<string> {
	const readers = [
		test_read_trace.stack_reader({ root, frames: caller_frames(), recorder: RECORDER }),
		current_test(root),
	]

	return readers.filter((reader) => reader !== undefined)
}

function read_path_of(root: string, argument: unknown): string | undefined {
	const target = test_read_trace.read_target(argument, process.cwd())

	return target === undefined ? undefined : test_read_trace.repository_path(root, target)
}

function record_read(state: RecorderState, argument: unknown, kind: ReadKind = 'path'): void {
	const read_path = read_path_of(state.root, argument)

	if (read_path === undefined) return

	const key = test_read_trace.read_key(read_path, kind)

	for (const reader of call_readers(state.root)) {
		test_read_trace.add_reader(state.records, key, reader)
	}
}

// A recording must never change what a test sees: a failure to record — a cwd a fixture deleted —
// is dropped, and the read goes ahead.
function safely_record(state: RecorderState, name: string, parameters: Array<unknown>): void {
	try {
		record_read(state, parameters[0], test_read_trace.read_kind(name, parameters[1]))
	} catch {
		// The read is not recorded; nothing the test observes changes.
	}
}

function wrap_read(owner: object, name: string, state: RecorderState): void {
	const original: unknown = Reflect.get(owner, name)

	if (typeof original !== 'function') return

	// Bound here because a hoisted function declaration does not keep the narrowing above.
	const read = original

	function recorded(this: unknown, ...parameters: Array<unknown>): unknown {
		safely_record(state, name, parameters)

		return Reflect.apply(read, this, parameters)
	}

	Reflect.set(owner, name, recorded)
}

// `syncBuiltinESMExports` is what carries the patch to `import { readFileSync } from 'node:fs'`:
// a named import of a builtin is a binding of the module's exports, refreshed only by that call.
function install(root: string, directory: string): RecorderState {
	const state: RecorderState = { root, directory, records: new Map(), flushes: 0 }

	for (const name of [...SYNC_READS, ...ASYNC_READS]) wrap_read(fs, name, state)
	for (const name of ASYNC_READS) wrap_read(fs.promises, name, state)

	syncBuiltinESMExports()
	Reflect.set(globalThis, STATE_KEY, state)

	return state
}

function is_state(value: unknown): value is RecorderState {
	return typeof value === 'object' && value !== null && Reflect.has(value, 'records')
}

function existing_state(): RecorderState | undefined {
	const value: unknown = Reflect.get(globalThis, STATE_KEY)

	return is_state(value) ? value : undefined
}

// One file per flush, named by process, thread and sequence, so no two workers write the same file.
function flush(state: RecorderState): void {
	if (state.records.size === 0) return

	state.flushes += 1

	const name = `${String(process.pid)}-${String(threadId)}-${String(state.flushes)}.json`

	fs.writeFileSync(
		path.join(state.directory, name),
		JSON.stringify(test_read_trace.to_records(state.records)),
	)
	state.records.clear()
}

function arm(): void {
	const directory = process.env[test_read_trace.RECORD_DIRECTORY_KEY]
	const root = process.env[test_read_trace.ROOT_KEY]

	if (directory === undefined || root === undefined) return

	const state = existing_state() ?? install(root, directory)

	afterAll(() => {
		flush(state)
	})
}

const test_read_capture = {
	arm,
	flush,
	record_read,
	wrap_read,
}

export type { RecorderState }
export { test_read_capture }
