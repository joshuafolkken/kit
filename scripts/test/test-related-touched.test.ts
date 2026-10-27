import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { test_related_touched, type ListDirectory } from './test-related-touched'

const ROOT = path.resolve('/repo')
const DIRECTORY = path.join('scripts', 'test')
const MODULE = 'foo.ts'
const MODULE_TEST = 'foo.test.ts'
const MODULE_CLAIM_TEST = 'foo.claim.test.ts'
const UNTESTED_MODULE = 'bar.ts'
const OTHER_TEST = 'baz.test.ts'
const DATA_FILE = 'notes.md'
const LISTING = [
	MODULE,
	MODULE_TEST,
	MODULE_CLAIM_TEST,
	'foo-bar.test.ts',
	UNTESTED_MODULE,
	OTHER_TEST,
	DATA_FILE,
	'notes.test.ts',
]

function at(name: string): string {
	return path.join(DIRECTORY, name)
}

function list(directory: string): ReadonlyArray<string> {
	return directory === path.join(ROOT, DIRECTORY) ? LISTING : []
}

const LIST: ListDirectory = list

// joshuafolkken/kit#5237: the touched scope is the diff's test files and its modules' same-named tests,
// read off the directory alone — no test-read map, no import graph.
describe('test_related_touched.touched_tests', () => {
	it('runs a changed module through foo.test.ts and foo.*.test.ts, never a foo-prefixed sibling', () => {
		expect(test_related_touched.touched_tests(ROOT, [at(MODULE)], LIST)).toEqual([
			at(MODULE_TEST),
			at(MODULE_CLAIM_TEST),
		])
	})

	it('runs a test file of the diff itself, and nothing for a deleted one', () => {
		expect(
			test_related_touched.touched_tests(ROOT, [at(OTHER_TEST), at('gone.test.ts')], LIST),
		).toEqual([at(OTHER_TEST)])
	})

	it('runs nothing for a module with no same-named test or a non-code file', () => {
		expect(
			test_related_touched.touched_tests(ROOT, [at(UNTESTED_MODULE), at(DATA_FILE)], LIST),
		).toEqual([])
	})

	it('names each test once when the module and its test are both in the diff', () => {
		expect(test_related_touched.touched_tests(ROOT, [at(MODULE), at(MODULE_TEST)], LIST)).toEqual([
			at(MODULE_TEST),
			at(MODULE_CLAIM_TEST),
		])
	})
})

describe('test_related_touched.touched_scope', () => {
	it('narrows to the touched tests as absolute paths', () => {
		expect(test_related_touched.touched_scope(ROOT, [at(MODULE)], LIST)).toEqual({
			mode: 'related',
			files: [path.join(ROOT, at(MODULE_TEST)), path.join(ROOT, at(MODULE_CLAIM_TEST))],
			reason: test_related_touched.TOUCHED_REASON,
		})
	})

	it('runs no test when nothing touched has one', () => {
		expect(test_related_touched.touched_scope(ROOT, [at(UNTESTED_MODULE)], LIST)).toMatchObject({
			mode: 'none',
			reason: test_related_touched.NOTHING_TOUCHED_REASON,
		})
	})

	it('runs the whole suite when the diff could not be read', () => {
		expect(test_related_touched.touched_scope(ROOT, undefined, LIST).mode).toBe('all')
	})
})
