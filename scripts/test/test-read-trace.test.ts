import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { test_read_trace, type CallFrame } from './test-read-trace'

// joshuafolkken/kit#4065: what one recorded read says — the repository path read, and the module
// that read it. A wrong answer here is a map entry that narrows a changed file to the wrong tests.

const ROOT = path.resolve('/repo')
const SCRIPTS = path.join(ROOT, 'scripts')
const RECORDER = path.join(SCRIPTS, 'test', 'test-read-capture.ts')
const READER_RELATIVE = path.join('scripts', 'docs-reader.ts')
const READER = path.join(ROOT, READER_RELATIVE)
const TEST_FILE = path.join(SCRIPTS, 'docs-reader.test.ts')
const HELPER = path.join(SCRIPTS, 'lib', 'read-file.ts')
const DOCUMENT = 'docs/a.md'
const DEPENDENCY = path.join(ROOT, 'node_modules', 'glob', 'index.js')

describe('test_read_trace.script_path', () => {
	it('reads a file URL and an absolute path alike', () => {
		expect(test_read_trace.script_path(pathToFileURL(READER).href)).toBe(READER)
		expect(test_read_trace.script_path(READER)).toBe(READER)
	})

	it.each(['node:fs', '', 'evalmachine.<anonymous>'])('names no file for %j', (script_name) => {
		expect(test_read_trace.script_path(script_name)).toBeUndefined()
	})
})

// joshuafolkken/kit#4071: a listing of a directory depends on its entries, not on everything
// beneath it, so the kind of read is part of what the map records.
describe('test_read_trace.read_kind', () => {
	it.each([
		['readFileSync', undefined, 'path'],
		['statSync', undefined, 'path'],
		['existsSync', undefined, 'path'],
		['readdirSync', undefined, 'listing'],
		['readdir', { withFileTypes: true }, 'listing'],
		['readdir', () => undefined, 'listing'],
		['opendir', { recursive: false }, 'listing'],
		['readdirSync', { recursive: true }, 'walk'],
		['opendirSync', { recursive: true }, 'walk'],
	])('reads %s with %j as a %s read', (name, options, kind) => {
		expect(test_read_trace.read_kind(name, options)).toBe(kind)
	})
})

describe('test_read_trace.read_key', () => {
	it('keys a path read by the path, and a directory read by a glob-shaped suffix', () => {
		expect(test_read_trace.read_key(DOCUMENT, 'path')).toBe(DOCUMENT)
		expect(test_read_trace.read_key('docs', 'listing')).toBe(path.join('docs', '*'))
		expect(test_read_trace.read_key('docs', 'walk')).toBe(path.join('docs', '**'))
		expect(test_read_trace.read_key(test_read_trace.ROOT_ENTRY, 'listing')).toBe('*')
	})
})

describe('test_read_trace.repository_path', () => {
	it('answers a path relative to the root, and `.` for the root itself', () => {
		expect(test_read_trace.repository_path(ROOT, path.join(ROOT, 'docs', 'a.md'))).toBe(
			path.join('docs', 'a.md'),
		)
		expect(test_read_trace.repository_path(ROOT, ROOT)).toBe(test_read_trace.ROOT_ENTRY)
	})

	it.each([
		['outside the root', path.resolve('/elsewhere', 'a.md')],
		['inside node_modules', DEPENDENCY],
		['inside .git', path.join(ROOT, '.git', 'HEAD')],
	])('drops a path %s', (_case, file_path) => {
		expect(test_read_trace.repository_path(ROOT, file_path)).toBeUndefined()
	})
})

describe('test_read_trace.read_target', () => {
	it('resolves a relative path against the working directory', () => {
		expect(test_read_trace.read_target('docs/a.md', ROOT)).toBe(path.join(ROOT, 'docs', 'a.md'))
	})

	it('reads a URL argument', () => {
		expect(test_read_trace.read_target(pathToFileURL(READER), ROOT)).toBe(READER)
	})

	it.each([[3], [Buffer.from('a')], [undefined]])('names no path for %j', (argument) => {
		expect(test_read_trace.read_target(argument, ROOT)).toBeUndefined()
	})
})

// A call site; an empty function name is a module's top-level code or an anonymous callback.
function frame(script_name: string, function_name = ''): CallFrame {
	return { script_name, function_name }
}

function reader_of(frames: ReadonlyArray<CallFrame>): string | undefined {
	return test_read_trace.stack_reader({ root: ROOT, frames, recorder: RECORDER })
}

const INNER_FRAMES = [frame('node:fs', 'readFileSync'), frame(RECORDER, 'recorded')]

describe('test_read_trace.stack_reader', () => {
	// joshuafolkken/kit#4417: a shared helper between the test and `fs` answered as the reader, and
	// `vitest related` widened every read through it to every test importing the helper.
	it('answers the test, not the helper it read through, for a read a test makes', () => {
		const frames = [
			...INNER_FRAMES,
			frame(DEPENDENCY, 'walk'),
			frame(READER, 'read_docs'),
			frame(TEST_FILE),
		]

		expect(reader_of(frames)).toBe(path.relative(ROOT, TEST_FILE))
	})

	it('answers the module whose evaluation made the read when no test is on the stack', () => {
		const frames = [...INNER_FRAMES, frame(HELPER, 'read_file'), frame(READER), frame(DEPENDENCY)]

		expect(reader_of(frames)).toBe(READER_RELATIVE)
	})

	// joshuafolkken/kit#5033: `import-graph.ts` read after an `await`, so it was outermost and widened
	// some 3,700 paths to every test importing it. The test running it is recorded beside instead.
	it('answers nothing for a read a named function made after an await dropped its caller', () => {
		const frames = [...INNER_FRAMES, frame(HELPER, 'read_file'), frame(READER, 'create')]

		expect(reader_of(frames)).toBeUndefined()
	})

	it('answers nothing when no frame is a repository module', () => {
		expect(reader_of([...INNER_FRAMES, frame(DEPENDENCY)])).toBeUndefined()
	})
})

describe('test_read_trace records', () => {
	it('collects each reader once per read path', () => {
		const records = new Map<string, Set<string>>()

		test_read_trace.add_reader(records, DOCUMENT, 'a.ts')
		test_read_trace.add_reader(records, DOCUMENT, 'a.ts')
		test_read_trace.add_reader(records, DOCUMENT, 'b.ts')

		expect(test_read_trace.to_records(records)).toEqual({ [DOCUMENT]: ['a.ts', 'b.ts'] })
	})
})
