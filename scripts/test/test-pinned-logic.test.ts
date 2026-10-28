import { describe, expect, it } from 'vitest'
import { test_pinned_logic, type Hunk, type PinnedReport } from './test-pinned-logic'

const DRIVER = 'scripts/run/driver.ts'
const EMPTY_REPORT: PinnedReport = {
	unpinned: [],
	stopped: [],
	unchecked: [],
	unparsed: [],
	max_hunks: 1,
	has_runner: true,
}

const GREEN_LINE = 'unpinned a.ts:3 — reverting it left every related test green\n'

function printed(report: PinnedReport): string {
	return test_pinned_logic.report_text(test_pinned_logic.report_parts(report))
}

const MODIFIED_DIFF = [
	`diff --git a/${DRIVER} b/${DRIVER}`,
	`--- a/${DRIVER}`,
	`+++ b/${DRIVER}`,
	'@@ -57 +57 @@ function run(argv) {',
	'-\treturn result.token',
	'+\treturn argv.includes(DRIVER_FLAG) ? print(result) : result.token',
	'@@ -70,2 +69,0 @@',
	'-const A = 1',
	'-const B = 2',
	'@@ -80,0 +79,3 @@',
	'+one',
	'+two',
	'+three',
].join('\n')

// joshuafolkken/kit#4775: each hunk keeps the lines it put in, for an unpinned place's key.
const MODIFIED_HUNKS: Array<Hunk> = [
	{
		file: DRIVER,
		new_start: 57,
		new_count: 1,
		old_lines: ['\treturn result.token'],
		new_lines: ['\treturn argv.includes(DRIVER_FLAG) ? print(result) : result.token'],
	},
	{
		file: DRIVER,
		new_start: 69,
		new_count: 0,
		old_lines: ['const A = 1', 'const B = 2'],
		new_lines: [],
	},
	{ file: DRIVER, new_start: 79, new_count: 3, old_lines: [], new_lines: ['one', 'two', 'three'] },
]

const ONE_LINE_HUNK = ['@@ -1 +1 @@', '-old', '+new']

const SKIPPED_DIFF = [
	'--- a/scripts/run/driver.test.ts',
	'+++ b/scripts/run/driver.test.ts',
	...ONE_LINE_HUNK,
	'--- a/docs/guide.md',
	'+++ b/docs/guide.md',
	'@@ -3,2 +3,2 @@',
	'-a',
	'-b',
	'+c',
	'+d',
].join('\n')

function hunk(overrides: Partial<Hunk>): Hunk {
	return { file: 'a.ts', new_start: 1, new_count: 1, old_lines: [], ...overrides }
}

describe('test_pinned_logic.parse_hunks', () => {
	it('reads each hunk with its working-file range and the base lines it replaced', () => {
		expect(test_pinned_logic.parse_hunks(MODIFIED_DIFF)).toEqual(MODIFIED_HUNKS)
	})

	it('leaves a quoted-path section on no file rather than on the file before it', () => {
		const quoted = [
			'diff --git "a/scripts/a b.ts" "b/scripts/a b.ts"',
			'+++ "b/scripts/a b.ts"',
			...ONE_LINE_HUNK,
		].join('\n')

		expect(test_pinned_logic.parse_hunks(`${MODIFIED_DIFF}\n${quoted}`)).toHaveLength(3)
	})

	it('skips test files and files vitest cannot relate, keeping no orphan base lines', () => {
		expect(test_pinned_logic.parse_hunks(`${SKIPPED_DIFF}\n${MODIFIED_DIFF}`)).toHaveLength(3)
		expect(test_pinned_logic.parse_hunks(SKIPPED_DIFF)).toEqual([])
	})
})

describe('test_pinned_logic.all_hunks', () => {
	it('keeps the hunks of test files and files vitest cannot relate', () => {
		const files = test_pinned_logic.all_hunks(SKIPPED_DIFF).map((entry) => entry.file)

		expect(files).toEqual(['scripts/run/driver.test.ts', 'docs/guide.md'])
	})

	it('names a deleted file by its `--- a/` path', () => {
		const deleted = [
			'diff --git a/docs/gone.md b/docs/gone.md',
			'--- a/docs/gone.md',
			'+++ /dev/null',
			'@@ -1 +0,0 @@',
			'-# Gone',
		].join('\n')

		expect(test_pinned_logic.all_hunks(deleted)).toEqual([
			{ file: 'docs/gone.md', new_start: 0, new_count: 0, old_lines: ['# Gone'], new_lines: [] },
		])
	})
})

describe('test_pinned_logic.revert', () => {
	const content = 'a\nb\nc\nd\n'

	it('puts a changed line back to its base text', () => {
		const changed = hunk({ new_start: 2, new_count: 1, old_lines: ['B'] })

		expect(test_pinned_logic.revert(content, changed)).toBe('a\nB\nc\nd\n')
	})

	it('removes an added range', () => {
		const added = hunk({ new_start: 2, new_count: 2, old_lines: [] })

		expect(test_pinned_logic.revert(content, added)).toBe('a\nd\n')
	})

	it('puts deleted lines back after the line the deletion header names', () => {
		const deleted = hunk({ new_start: 1, new_count: 0, old_lines: ['x', 'y'] })

		expect(test_pinned_logic.revert(content, deleted)).toBe('a\nx\ny\nb\nc\nd\n')
	})

	it('puts deleted lines back at the top when the deletion header names line 0', () => {
		const deleted = hunk({ new_start: 0, new_count: 0, old_lines: ['x'] })

		expect(test_pinned_logic.revert(content, deleted)).toBe('x\na\nb\nc\nd\n')
	})
})

describe('test_pinned_logic.split and format', () => {
	const first = hunk({ file: 'a.ts', new_start: 3 })
	const second = hunk({ file: 'b.ts', new_start: 0, new_count: 0 })

	it('checks the hunks up to the cap and leaves the rest unchecked', () => {
		expect(test_pinned_logic.split([first, second], 1)).toEqual({
			checked: [first],
			unchecked: [second],
		})
	})

	it('prints unpinned and unchecked hunks as file:line, a line-0 deletion as line 1', () => {
		const report = {
			...EMPTY_REPORT,
			unpinned: [{ ...first, is_green: true }],
			unchecked: [second],
		}

		expect(test_pinned_logic.format(report)).toBe(
			`${GREEN_LINE}unchecked b.ts:1 — over the 1-hunk cap`,
		)
	})

	it('says no related test ran rather than green when nothing ran with the hunk reverted', () => {
		const report = { ...EMPTY_REPORT, unpinned: [{ ...first, is_green: false }] }

		expect(test_pinned_logic.format(report)).toBe(
			'unpinned a.ts:3 — no related test ran with it reverted',
		)
	})
})

// joshuafolkken/kit#5043: a revert that stops vitest (its config could not load) is not "no related test".
describe('test_pinned_logic.outcome and a stopped hunk', () => {
	const hunks = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((file) => hunk({ file, new_start: 3 }))
	const [, green, no_test, stopped] = hunks

	it('sets a stopped hunk aside, pins a red one and leaves green and no-test unpinned', () => {
		const verdicts = [
			{ verdict: 'red', failed: [] },
			{ verdict: 'green', failed: [] },
			{ verdict: 'no-test', failed: [] },
			{ verdict: 'stopped', failed: [] },
			undefined,
		] as const

		expect(test_pinned_logic.outcome(hunks, verdicts)).toEqual({
			unpinned: [
				{ ...green, is_green: true },
				{ ...no_test, is_green: false },
			],
			stopped: [stopped],
		})
	})

	it('prints a hunk whose revert stopped vitest as unchecked, never as unpinned', () => {
		const report = { ...EMPTY_REPORT, stopped: [hunk({ file: 'a.ts', new_start: 3 })] }

		expect(printed(report)).toBe(
			'unchecked 1 — vitest stopped before any test ran with it reverted\nunpinned 0 · unchecked 1\n',
		)
	})
})

describe('test_pinned_logic.format with nothing left, and on an added file function', () => {
	const first = hunk({ file: 'a.ts', new_start: 3 })

	it('prints nothing when every checked hunk is pinned and none is left over', () => {
		expect(test_pinned_logic.format(EMPTY_REPORT)).toBe('')
	})

	it('names the function and says its body was replaced, green or not run', () => {
		const stub = { ...first, function_name: 'tree.discard' }
		const report = {
			...EMPTY_REPORT,
			unpinned: [
				{ ...stub, is_green: true },
				{ ...stub, is_green: false },
			],
		}

		expect(test_pinned_logic.format(report)).toBe(
			'unpinned a.ts:3 tree.discard — replacing its body with a throw left every related test green\n' +
				'unpinned a.ts:3 tree.discard — no related test ran with its body replaced by a throw',
		)
	})
})

describe('test_pinned_logic.report_text', () => {
	const one_unchecked = 'unpinned 0 · unchecked 1\n'

	it('counts an added file it could not read as unchecked', () => {
		const report = { ...EMPTY_REPORT, unparsed: ['added.ts'] }

		expect(printed(report)).toBe(
			`unchecked 1 — an added file, and typescript is not installed to read its functions\n${one_unchecked}`,
		)
	})

	it('says no vitest ran a hunk it left unchecked for want of one, rather than naming the cap', () => {
		const report = {
			...EMPTY_REPORT,
			unchecked: [hunk({ file: 'a.ts', new_start: 3 })],
			max_hunks: 20,
			has_runner: false,
		}

		expect(printed(report)).toBe(
			`unchecked 1 — vitest is not installed to run its related tests\n${one_unchecked}`,
		)
	})

	it('prints only the counts when nothing is unpinned or unchecked', () => {
		expect(printed(EMPTY_REPORT)).toBe('unpinned 0 · unchecked 0\n')
	})

	// joshuafolkken/kit#5292
	it('prints how many probes the direct importers decided and how many escalated', () => {
		const report = { ...EMPTY_REPORT, staged: { direct: 3, escalated: 1 } }

		expect(printed(report)).toBe('unpinned 0 · unchecked 0 · direct 3 · escalated 1\n')
	})

	it('counts a hunk a --first-unpinned run stopped before as unchecked', () => {
		const report = { ...EMPTY_REPORT, cut: [hunk({ file: 'a.ts', new_start: 3 })] }

		expect(printed(report)).toBe(
			`unchecked 1 — not probed: the run stopped at the first unpinned hunk\n${one_unchecked}`,
		)
	})
})

// joshuafolkken/kit#5188: a cap's overflow pushed the unpinned places and the note out of a `tail`.
describe('test_pinned_logic.report_text in the verification-tail shape', () => {
	const unpinned = { ...hunk({ file: 'a.ts', new_start: 3 }), is_green: true }
	const over_cap = ['b.ts', 'c.ts', 'd.ts'].map((file) => hunk({ file, new_start: 1 }))
	const report = { ...EMPTY_REPORT, unpinned: [unpinned], unchecked: over_cap }
	const log = { path: 'josh-test-pinned-list.log' }

	it('folds the unchecked places to one line per reason, below the unpinned places', () => {
		expect(printed(report)).toBe(
			`${GREEN_LINE}unchecked 3 — over the 1-hunk cap\nunpinned 1 · unchecked 3\n`,
		)
	})

	it('puts the note and the full list path above the counts line, which ends it', () => {
		const text = test_pinned_logic.report_text(
			{ ...test_pinned_logic.report_parts(report), log },
			'Pin each.\n',
		)

		expect(text.split('\n').slice(-4)).toEqual([
			'Pin each.',
			`full output: ${log.path}`,
			'unpinned 1 · unchecked 3',
			'',
		])
	})

	it('prints the text and the note alone where no counts line was reached', () => {
		expect(test_pinned_logic.report_text({ text: 'not run\n' }, 'Pin each.\n')).toBe(
			'not run\nPin each.\n',
		)
	})

	it('says whether any place was folded, so a full list is worth keeping', () => {
		expect(test_pinned_logic.has_unchecked(report)).toBe(true)
		expect(test_pinned_logic.has_unchecked({ ...report, unchecked: [] })).toBe(false)
	})
})

// joshuafolkken/kit#5153: the probes run fewest reached tests first, so a run that stops at its first
// unpinned hunk reaches it soonest.
const REACH_FILES = ['wide.ts', 'mid.ts', 'narrow.ts']

function reach_order(reach: ReadonlyMap<string, number>): Array<string> {
	const probes = REACH_FILES.map((file) => ({ hunk: hunk({ file }) }))

	return test_pinned_logic.by_reach(probes, reach).map((probe) => probe.hunk.file)
}

describe('test_pinned_logic.by_reach', () => {
	it('orders the probes by the tests their file reaches, ascending', () => {
		const reach = new Map([
			['wide.ts', 500],
			['mid.ts', 50],
			['narrow.ts', 5],
		])

		expect(reach_order(reach)).toEqual(['narrow.ts', 'mid.ts', 'wide.ts'])
	})

	it('keeps the diff order where no count was read', () => {
		expect(reach_order(new Map())).toEqual(REACH_FILES)
	})
})

describe('test_pinned_logic.is_unpinned', () => {
	it.each([
		['green', true],
		['no-test', true],
		['red', false],
		['stopped', false],
	] as const)('reads a %s verdict as unpinned: %s', (verdict, expected) => {
		expect(test_pinned_logic.is_unpinned({ verdict, failed: [], ran: 1 })).toBe(expected)
	})
})
