import path from 'node:path'
import { outer_command } from '#scripts/josh/outer-command'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { describe, expect, it } from 'vitest'
import { test_related_touched, type CallSite, type ListDirectory } from './test-related-touched'

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

	// joshuafolkken/kit#5642: a command-table change also runs the registry tests it never names.
	it('adds the pinned registry tests to a command-table change', () => {
		const command_table = path.join('scripts', 'josh', 'josh-commands-development.ts')

		expect(test_related_touched.touched_tests(ROOT, [command_table], LIST)).toEqual([
			'scripts/josh/josh-logic.test.ts',
			'scripts/josh/josh-command-map.test.ts',
			'scripts/josh/josh-in-process.test.ts',
		])
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

// joshuafolkken/kit#7593: a lane's own bare call runs the touched scope; a nested call or one outside a
// lane keeps the full reach.
describe('test_related_touched.scoped_arguments', () => {
	const ISSUE = '7593'
	const COMMAND = 'test:related'
	const LANE = `/home/dev/.kit-lanes/${ISSUE}`
	const CHECK_RELATED = 'check:related'
	const { TOUCHED_FLAG, scoped_arguments } = test_related_touched

	function site(outer: string, options: { directory?: string; is_lane?: boolean } = {}): CallSite {
		const { directory = LANE, is_lane = true } = options
		const mark = is_lane ? { [lane_child_marker.KEY]: ISSUE } : {}

		return { directory, source: { ...mark, [outer_command.KEY]: outer }, notify: () => undefined }
	}

	it('runs a lane bare call typed by its session with --touched, and says so in one line', () => {
		const lines: Array<string> = []
		const typed = {
			...site(COMMAND),
			notify: (line: string): void => {
				lines.push(line)
			},
		}

		expect(scoped_arguments([], typed)).toEqual([TOUCHED_FLAG])
		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain(CHECK_RELATED)
	})

	it('keeps an explicit --touched as given', () => {
		expect(scoped_arguments([TOUCHED_FLAG], site(COMMAND))).toEqual([TOUCHED_FLAG])
	})

	it('keeps the full reach for a call check:related makes inside a lane', () => {
		expect(scoped_arguments([], site(CHECK_RELATED))).toEqual([])
	})

	it('keeps the full reach outside a lane', () => {
		expect(scoped_arguments([], site(COMMAND, { directory: '/home/dev/repo' }))).toEqual([])
		expect(scoped_arguments([], site(COMMAND, { is_lane: false }))).toEqual([])
	})
})

describe('test_related_touched.read_scope', () => {
	it('preserves the full-suite fallback for an unreadable change', async () => {
		expect(await test_related_touched.read_scope(ROOT, undefined)).toEqual(
			test_related_touched.touched_scope(ROOT, undefined),
		)
	})

	it('runs no test for an empty change without needing an import graph', async () => {
		expect(await test_related_touched.read_scope(ROOT, [])).toMatchObject({ mode: 'none' })
	})
})
