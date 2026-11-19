import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { test_pinned_logic } from './test-pinned-logic'
import { test_symbol_select, type ChangedLines, type SymbolInput } from './test-symbol-select'
import type { Source } from './test-symbol-users'

const LIB = 'src/lib.ts'
const MID = 'src/mid.ts'
const ONE_TEST = 'src/one.test.ts'
const TWO_TEST = 'src/two.test.ts'
const MOCKING_TEST = 'src/mocking.test.ts'
const REGISTRY = 'scripts/josh/josh-commands-thing.ts'
const SOLO = 'src/solo.ts'
const FAR_TEST = 'src/far-0.test.ts'

const LIB_SOURCE: Source = {
	file: LIB,
	text: 'function one() { return 1 }\nfunction two() { return 2 }\nexport { one, two }\n',
}
const ONE_SOURCE: Source = { file: ONE_TEST, text: `import { one } from './lib'\nit('o', one)\n` }
const TWO_SOURCE: Source = { file: TWO_TEST, text: `import { two } from './lib'\nit('t', two)\n` }
const MOCKING_SOURCE: Source = {
	file: MOCKING_TEST,
	text: `import { one } from './lib'\nvi.mock('./lib')\nit('m', one)\n`,
}
const LIB_SOURCES: ReadonlyArray<Source> = [LIB_SOURCE, ONE_SOURCE, TWO_SOURCE, MOCKING_SOURCE]
const MID_SOURCE: Source = {
	file: MID,
	text: `import { one } from './lib'\nfunction mid() { return one() }\nexport { mid }\n`,
}

function input_of(
	sources: ReadonlyArray<Source>,
	changed: ReadonlyArray<string>,
	lines: ChangedLines = new Map(),
): SymbolInput {
	return { typescript: ts, sources, changed, lines, imports: {} }
}

function by_name(left: string, right: string): number {
	return left.localeCompare(right)
}

function far_tests(count: number): Array<Source> {
	return Array.from({ length: count }, (_, index) => ({
		file: `src/far-${String(index)}.test.ts`,
		text: `import { mid } from './mid'\nit('f', mid)\n`,
	}))
}

describe('test_symbol_select.select_from', () => {
	it('selects the tests using a changed declaration and counts them for the file', () => {
		const input = input_of(LIB_SOURCES, [LIB], new Map([[LIB, [1]]]))

		expect(test_symbol_select.select_from(input)).toEqual({
			tests: [ONE_TEST],
			reach: [{ file: LIB, count: 1 }],
			direct: [ONE_TEST],
		})
	})

	it('reads a file with no lines listed as changed whole, less the test mocking it', () => {
		const { tests } = test_symbol_select.select_from(input_of(LIB_SOURCES, [LIB]))

		expect(tests.toSorted(by_name)).toEqual([ONE_TEST, TWO_TEST])
	})

	it('follows every user while the selection stays within the cap', () => {
		const sources = [LIB_SOURCE, ONE_SOURCE, MID_SOURCE, ...far_tests(1)]
		const { tests } = test_symbol_select.select_from(
			input_of(sources, [LIB], new Map([[LIB, [1]]])),
		)

		expect(tests.toSorted(by_name)).toEqual([FAR_TEST, ONE_TEST])
	})

	it('falls back to one file boundary where every user exceeds the cap', () => {
		const far = far_tests(test_pinned_logic.MAX_TEST_FILES)
		const sources = [LIB_SOURCE, ONE_SOURCE, MID_SOURCE, ...far]
		const selection = test_symbol_select.select_from(
			input_of(sources, [LIB], new Map([[LIB, [1]]])),
		)

		expect(selection).toMatchObject({ tests: [ONE_TEST], direct: [ONE_TEST] })
	})
})

describe('test_symbol_select.select_from — the direct users', () => {
	it('reads the users within one file boundary as direct while following every user', () => {
		const sources = [LIB_SOURCE, ONE_SOURCE, MID_SOURCE, ...far_tests(1)]
		const { tests, direct } = test_symbol_select.select_from(
			input_of(sources, [LIB], new Map([[LIB, [1]]])),
		)

		expect(tests.toSorted(by_name)).toEqual([FAR_TEST, ONE_TEST])
		expect(direct).toEqual([ONE_TEST])
	})
})

describe('test_symbol_select.select_from — a command registry', () => {
	it('selects the tests naming a command whose registry entry changed', () => {
		const registry: Source = {
			file: REGISTRY,
			text: `const THING_COMMANDS = {\n\t'thing:do': { run: do_thing },\n}\nexport { THING_COMMANDS }\n`,
		}
		const naming: Source = { file: 'scripts/thing.test.ts', text: `run(['thing:do'])\n` }
		const input = input_of([registry, naming], [REGISTRY], new Map([[REGISTRY, [2]]]))

		expect(test_symbol_select.select_from(input).tests).toEqual([naming.file])
	})
})

describe('test_symbol_select.counts_from', () => {
	it('counts each file as though it changed alone, unswayed by a wide neighbor', () => {
		const solo: Array<Source> = [
			{ file: SOLO, text: 'function s() { return 1 }\nexport { s }\n' },
			{
				file: 'src/relay.ts',
				text: `import { s } from './solo'\nexport function r() { return s() }\n`,
			},
			{ file: 'src/relay.test.ts', text: `import { r } from './relay'\nit('r', r)\n` },
		]
		const far = far_tests(test_pinned_logic.MAX_TEST_FILES)
		const sources = [...LIB_SOURCES, MID_SOURCE, ...far, ...solo]
		const input = input_of(sources, [LIB, SOLO])

		expect(test_symbol_select.counts_from(input)).toEqual([
			{ file: LIB, count: 2 },
			{ file: SOLO, count: 1 },
		])
	})
})

describe('test_symbol_select.changed_lines', () => {
	it('reads the added lines of a hunk and the lines either side of a pure deletion', () => {
		const diff = [
			'diff --git a/x.ts b/x.ts',
			'--- a/x.ts',
			'+++ b/x.ts',
			'@@ -3,0 +4,2 @@',
			'+a',
			'+b',
			'@@ -10,2 +11,0 @@',
			'-c',
			'-d',
			'',
		].join('\n')

		expect(test_symbol_select.changed_lines(diff)).toEqual(new Map([['x.ts', [4, 5, 11, 12]]]))
	})
})
