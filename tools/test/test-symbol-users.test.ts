import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { test_symbol_users, type Source } from './test-symbol-users'

const UNREACHABLE = Infinity
const MATH = 'math.ts'
const MATH_TEST = 'math.test.ts'
const SUB_TEST = 'sub.test.ts'
const TOTAL_TEST = 'total.test.ts'

const SOURCES: Array<Source> = [
	{
		file: MATH,
		text: `function add(a: number, b: number): number {
	return a + b
}

function sub(a: number, b: number): number {
	return a - b
}

const math = { add, sub }

export { math }
`,
	},
	{ file: 'barrel.ts', text: `export * from './math'\n` },
	{
		file: 'total.ts',
		text: `import { math } from './math'

function total(values: Array<number>): number {
	return values.reduce(math.add, 0)
}

export { total }
`,
	},
	{
		file: MATH_TEST,
		text: `import { math } from './math'

it('adds', () => {
	math.add(1, 2)
})
`,
	},
	{
		file: SUB_TEST,
		text: `import { math } from './barrel'

it('subtracts', () => {
	math.sub(1, 2)
})
`,
	},
	{
		file: TOTAL_TEST,
		text: `import { total } from './total'

it('totals', () => {
	total([1])
})
`,
	},
]

function resolve(specifier: string): string | undefined {
	return specifier.startsWith('./') ? `${specifier.slice('./'.length)}.ts` : undefined
}

function sorted(files: ReadonlySet<string>): Array<string> {
	return [...files].toSorted((left, right) => left.localeCompare(right))
}

function selected(lines: Array<number>, max_hops: number): Array<string> {
	const index = test_symbol_users.build(ts, resolve, SOURCES)
	const seeds = test_symbol_users.changed_keys(index, MATH, lines)

	return sorted(test_symbol_users.select(index, seeds, max_hops))
}

describe('test_symbol_users.select — users of changed declarations', () => {
	it('selects only the direct test users of a changed function within one hop', () => {
		expect(selected([2], 1)).toEqual([MATH_TEST])
	})

	it('reaches the test of a user in another file when walked in full', () => {
		expect(selected([2], UNREACHABLE)).toEqual([MATH_TEST, TOTAL_TEST])
	})

	it('selects the users of an unchanged sibling only when the sibling changes', () => {
		expect(selected([6], UNREACHABLE)).toEqual([SUB_TEST])
	})

	it('selects nothing for a line outside every declaration', () => {
		expect(selected([4], UNREACHABLE)).toEqual([])
	})
})

describe('test_symbol_users.import_reach — the file-level comparison', () => {
	it('selects every test whose imports reach the changed file', () => {
		const index = test_symbol_users.build(ts, resolve, SOURCES)
		const reached = test_symbol_users.import_reach(index, [MATH])

		expect(sorted(reached)).toEqual([MATH_TEST, SUB_TEST, TOTAL_TEST])
	})
})
