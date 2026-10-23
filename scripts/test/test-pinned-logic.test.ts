import { describe, expect, it } from 'vitest'
import { test_pinned_logic, type Hunk } from './test-pinned-logic'

const DRIVER = 'scripts/run/driver.ts'

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
		expect(test_pinned_logic.parse_hunks(MODIFIED_DIFF)).toEqual([
			{
				file: DRIVER,
				new_start: 57,
				new_count: 1,
				old_lines: ['\treturn result.token'],
			},
			{
				file: DRIVER,
				new_start: 69,
				new_count: 0,
				old_lines: ['const A = 1', 'const B = 2'],
			},
			{ file: DRIVER, new_start: 79, new_count: 3, old_lines: [] },
		])
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
			unpinned: [{ ...first, is_green: true }],
			unchecked: [second],
			unparsed: [],
			max_hunks: 1,
			has_runner: true,
		}

		expect(test_pinned_logic.format(report)).toBe(
			'unpinned a.ts:3 — reverting it left every related test green\n' +
				'unchecked b.ts:1 — over the 1-hunk cap',
		)
	})

	it('says no related test ran rather than green when nothing ran with the hunk reverted', () => {
		const report = {
			unpinned: [{ ...first, is_green: false }],
			unchecked: [],
			unparsed: [],
			max_hunks: 1,
			has_runner: true,
		}

		expect(test_pinned_logic.format(report)).toBe(
			'unpinned a.ts:3 — no related test ran with it reverted',
		)
	})
})

describe('test_pinned_logic.format with nothing left, and on an added file function', () => {
	const first = hunk({ file: 'a.ts', new_start: 3 })

	it('prints nothing when every checked hunk is pinned and none is left over', () => {
		expect(
			test_pinned_logic.format({
				unpinned: [],
				unchecked: [],
				unparsed: [],
				max_hunks: 1,
				has_runner: true,
			}),
		).toBe('')
	})

	it('names the function and says its body was replaced, green or not run', () => {
		const stub = { ...first, function_name: 'tree.discard' }
		const report = {
			unpinned: [
				{ ...stub, is_green: true },
				{ ...stub, is_green: false },
			],
			unchecked: [],
			unparsed: [],
			max_hunks: 1,
			has_runner: true,
		}

		expect(test_pinned_logic.format(report)).toBe(
			'unpinned a.ts:3 tree.discard — replacing its body with a throw left every related test green\n' +
				'unpinned a.ts:3 tree.discard — no related test ran with its body replaced by a throw',
		)
	})
})

describe('test_pinned_logic.report_text', () => {
	const one_unchecked = 'unpinned 0 · unchecked 1\n'

	it('counts an added file it could not read as unchecked and lists it', () => {
		const report = {
			unpinned: [],
			unchecked: [],
			unparsed: ['added.ts'],
			max_hunks: 1,
			has_runner: true,
		}

		expect(test_pinned_logic.report_text(report)).toBe(
			`${
				one_unchecked
			}unchecked added.ts — an added file, and typescript is not installed to read its functions\n`,
		)
	})

	it('says no vitest ran a hunk it left unchecked for want of one, rather than naming the cap', () => {
		const report = {
			unpinned: [],
			unchecked: [hunk({ file: 'a.ts', new_start: 3 })],
			unparsed: [],
			max_hunks: 20,
			has_runner: false,
		}

		expect(test_pinned_logic.report_text(report)).toBe(
			`${one_unchecked}unchecked a.ts:3 — vitest is not installed to run its related tests\n`,
		)
	})

	it('prints only the counts when nothing is unpinned or unchecked', () => {
		const report = { unpinned: [], unchecked: [], unparsed: [], max_hunks: 1, has_runner: true }

		expect(test_pinned_logic.report_text(report)).toBe('unpinned 0 · unchecked 0\n')
	})
})
