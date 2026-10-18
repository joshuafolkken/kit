import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { test_read_trace } from './test-read-trace'

// joshuafolkken/kit#4065: what one recorded read says — the repository path read, and the module
// that read it. A wrong answer here is a map entry that narrows a changed file to the wrong tests.

const ROOT = path.resolve('/repo')
const SCRIPTS = path.join(ROOT, 'scripts')
const RECORDER = path.join(SCRIPTS, 'test', 'test-read-capture.ts')
const READER_RELATIVE = path.join('scripts', 'docs-reader.ts')
const READER = path.join(ROOT, READER_RELATIVE)
const TEST_FILE = path.join(SCRIPTS, 'docs-reader.test.ts')
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

describe('test_read_trace.stack_reader', () => {
	it('answers the first repository frame below the recorder', () => {
		const scripts = ['node:fs', RECORDER, DEPENDENCY, READER, TEST_FILE]

		expect(test_read_trace.stack_reader({ root: ROOT, scripts, recorder: RECORDER })).toBe(
			READER_RELATIVE,
		)
	})

	it('answers nothing when no frame is a repository module', () => {
		const scripts = ['node:fs', RECORDER, DEPENDENCY]

		expect(
			test_read_trace.stack_reader({ root: ROOT, scripts, recorder: RECORDER }),
		).toBeUndefined()
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
