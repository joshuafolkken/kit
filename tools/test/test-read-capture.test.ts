import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { threadId } from 'node:worker_threads'
import { test_read_trace } from '#scripts/test/test-read-trace'
import { test_read_capture, type RecorderState } from '#tools/test/test-read-capture'
import { test_read_capture_fixture } from '#tools/test/test-read-capture-fixture'
import { describe, expect, it, onTestFinished } from 'vitest'

// joshuafolkken/kit#4065: what the read recorder writes is what the test-read map is built from, so
// a read must land under the test that made it, and every flush must land in a file of its own.

const THIS_TEST = path.join('tools', 'test', 'test-read-capture.test.ts')
const READ_FILE = 'package.json'
const OTHER_READ_FILE = 'tsconfig.json'

// A state writing into a directory of its own, removed when the test finishes.
function fresh_state(): RecorderState {
	const directory = mkdtempSync(path.join(os.tmpdir(), 'test-read-capture-'))

	onTestFinished(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	return { root: process.cwd(), directory, records: new Map(), flushes: 0 }
}

function flushed(state: RecorderState): Array<string> {
	return readdirSync(state.directory).toSorted((left, right) => left.localeCompare(right))
}

describe('test_read_capture.record_read', () => {
	it('records a read under the test that made it, as a repository path', () => {
		const state = fresh_state()

		test_read_capture.record_read(state, READ_FILE)

		expect(test_read_trace.to_records(state.records)[READ_FILE]).toContain(THIS_TEST)
	})

	// joshuafolkken/kit#5033: the module was recorded beside the test, and `vitest related` widened the
	// read to every test importing it.
	it('records a read a module’s named function made after an await under the test alone', async () => {
		const state = fresh_state()

		await test_read_capture_fixture.record_after_await(state, READ_FILE)

		expect(test_read_trace.to_records(state.records)[READ_FILE]).toEqual([THIS_TEST])
	})

	// joshuafolkken/kit#4071
	it.each([
		['listing', path.join('scripts', '*')],
		['walk', path.join('scripts', '**')],
	] as const)('records a %s of a directory under its kind’s key', (kind, key) => {
		const state = fresh_state()

		test_read_capture.record_read(state, 'scripts', kind)

		expect(test_read_trace.to_records(state.records)[key]).toContain(THIS_TEST)
	})
})

describe('test_read_capture.wrap_read', () => {
	// joshuafolkken/kit#4071: the wrapped call's own name and options decide the kind it records.
	it.each([
		['readFileSync', undefined, 'scripts'],
		['readdirSync', undefined, path.join('scripts', '*')],
		['readdirSync', { recursive: true }, path.join('scripts', '**')],
	])('records a %s call with options %o under %s', (name, options, key) => {
		const state = fresh_state()
		const owner: Record<string, (...parameters: Array<unknown>) => unknown> = {
			[name]: (): undefined => undefined,
		}

		test_read_capture.wrap_read(owner, name, state)
		owner[name]?.('scripts', options)

		expect(test_read_trace.to_records(state.records)[key]).toContain(THIS_TEST)
	})
})

describe('test_read_capture.flush', () => {
	it('writes nothing when no read was recorded', () => {
		const state = fresh_state()

		test_read_capture.flush(state)

		expect(flushed(state)).toEqual([])
	})

	it('writes one file per flush, named by process, thread and sequence, and clears the record', () => {
		const state = fresh_state()
		const prefix = `${String(process.pid)}-${String(threadId)}`

		test_read_capture.record_read(state, READ_FILE)
		test_read_capture.flush(state)
		test_read_capture.record_read(state, OTHER_READ_FILE)
		test_read_capture.flush(state)

		expect(state.records.size).toBe(0)
		expect(flushed(state)).toEqual([`${prefix}-1.json`, `${prefix}-2.json`])
	})

	it('writes the recorded reads in the shape the map collects', () => {
		const state = fresh_state()

		test_read_capture.record_read(state, READ_FILE)
		test_read_capture.flush(state)

		const [name] = flushed(state)
		const text = readFileSync(path.join(state.directory, String(name)), 'utf8')

		expect(JSON.parse(text)).toEqual({ [READ_FILE]: [THIS_TEST] })
	})
})
