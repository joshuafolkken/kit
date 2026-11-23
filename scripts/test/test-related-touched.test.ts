import path from 'node:path'
import { outer_command } from '#scripts/josh/outer-command'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { describe, expect, it } from 'vitest'
import { test_read_map, type ReadMap } from './test-read-map'
import { test_read_trace } from './test-read-trace'
import { test_related_pins } from './test-related-pins'
import { test_related_touched, type CallSite, type ListDirectory } from './test-related-touched'

const ROOT = path.resolve('/repo')
// Outside `scripts/` and `tools/`, so no pin of `test-related-pins.ts` joins the fixture's tests.
const DIRECTORY = path.join('src', 'lib')
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

const COMMAND_DERIVE_TEST = 'tools/document/command-derive.test.ts'
const ENVIRONMENT_TEST = 'scripts/document/environment-file-reference.test.ts'
const TELEGRAM_TEST = 'scripts/josh/josh-command-telegram-environment.test.ts'
const UNTESTED_TEST = 'tools/test/untested-sources.test.ts'
const BUILD_HOOKS_TEST = 'scripts/build/build-hooks.test.ts'

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

// joshuafolkken/kit#8861: the shapes of the lanes whose first `check:related` went red — each reaches a
// test that reads a derived artifact or walks a tree, and imports none of it.
describe('test_related_touched.touched_tests with a derived-artifact pin', () => {
	// joshuafolkken/kit#5642: a command added to a table also runs the registry tests it never names.
	it('adds the pinned registry and derived-artifact tests to a command-table change', () => {
		const command_table = path.join('scripts', 'josh', 'josh-commands-development.ts')

		expect(test_related_touched.touched_tests(ROOT, [command_table], LIST)).toEqual([
			'scripts/josh/josh-logic.test.ts',
			'scripts/josh/josh-command-map.test.ts',
			'scripts/josh/josh-in-process.test.ts',
			COMMAND_DERIVE_TEST,
			ENVIRONMENT_TEST,
			TELEGRAM_TEST,
			UNTESTED_TEST,
		])
	})

	it.each([
		['a derived usage page (#8798, #8770)', 'docs/josh-commands-lane.md', COMMAND_DERIVE_TEST],
		['a hook source (#8782, #8771)', 'scripts/hooks/stop-guard.ts', BUILD_HOOKS_TEST],
		['a new source under tools/ (#8757)', 'tools/lane/lane-new.ts', UNTESTED_TEST],
		['the env-loading command list (#8750)', 'docs/environment-variables.md', ENVIRONMENT_TEST],
		['a script under scripts/ (#8750)', 'scripts/notify/notify-new.ts', TELEGRAM_TEST],
	])('runs the test %s reaches', (_shape, file, test) => {
		expect(test_related_touched.touched_tests(ROOT, [file], LIST)).toContain(test)
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

const BOARD = path.join('scripts', 'run', 'board')
const GLYPHS_TEST = path.join(BOARD, 'run-board-theme-glyphs.test.ts')
const WALK_TEST = path.join('scripts', 'walk.test.ts')
const NAME_TEST = path.join('scripts', 'name.test.ts')
const ADDED = path.join(BOARD, 'run-board-sweep.ts')

// A checkout holding the board directory's lister, a walker above it, a reader by name and the file
// added to the board.
function list_board(directory: string): ReadonlyArray<string> {
	const files = [GLYPHS_TEST, WALK_TEST, NAME_TEST, ADDED]

	return files
		.filter((file) => path.join(ROOT, path.dirname(file)) === directory)
		.map((file) => path.basename(file))
}

const BOARD_MAP: ReadMap = {
	version: test_read_map.MAP_VERSION,
	commit: 'abc',
	dirty: {},
	change: [],
	directories: [BOARD],
	readers: {
		[test_read_trace.read_key(BOARD, 'listing')]: [GLYPHS_TEST],
		[test_read_trace.read_key('scripts', 'walk')]: [WALK_TEST],
		[ADDED]: [NAME_TEST],
	},
}

// joshuafolkken/kit#8275: a test that enumerates a directory imports no file added there, so the
// touched scope takes the map's listing readers of the changed file's directory — and only those.
describe('test_related_touched.listing_readers', () => {
	const { listing_readers, touched_scope } = test_related_touched

	it('answers the test listing the directory a new file lands in, not its walkers or name readers', () => {
		expect(listing_readers([ADDED], BOARD_MAP)).toEqual([GLYPHS_TEST])
	})

	it('runs that listing test in the touched scope', () => {
		const changed = [ADDED, ...listing_readers([ADDED], BOARD_MAP)]

		expect(touched_scope(ROOT, changed, list_board).files).toEqual(
			[GLYPHS_TEST, ...test_related_pins.pinned_tests([ADDED])].map((file) =>
				path.join(ROOT, file),
			),
		)
	})

	it('adds no listing reader when there is no map, leaving the touched scope to the pins', () => {
		expect(listing_readers([ADDED], undefined)).toEqual([])
		expect(touched_scope(ROOT, [ADDED], list_board).files).toEqual(
			test_related_pins.pinned_tests([ADDED]).map((file) => path.join(ROOT, file)),
		)
	})
})

// A listing moves only when an entry appears or goes, so an edit in place adds no listing reader.
describe('test_related_touched.entry_moves', () => {
	const EDITED = path.join(BOARD, 'run-board.ts')
	const REMOVED = path.join(BOARD, 'run-board-gone.ts')
	const HELD = new Set([EDITED, REMOVED])

	function is_on_disk(file: string): boolean {
		return file !== REMOVED
	}

	it('keeps a file the base did not hold and one it held that is gone, not an edit in place', () => {
		expect(test_related_touched.entry_moves([ADDED, EDITED, REMOVED], HELD, is_on_disk)).toEqual([
			ADDED,
			REMOVED,
		])
	})
})
