import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { test_titles } from './test-titles'

// joshuafolkken/kit#4287: a removed test is found by comparing the tests a file declares before and
// after the change, so each must read as its full name — the blocks around it included.

const CLOSE_BLOCK = '})'
const LEAF = 'shades by lane'
const FULL_NAME = `board > usage > ${LEAF}`
const STANDS_ALONE = 'stands alone'

function titles(lines: ReadonlyArray<string>): ReadonlyArray<string> {
	return test_titles.titles_of(ts, lines.join('\n'))
}

describe('test_titles.titles_of — the tests a file declares', () => {
	it('names each test with the blocks around it, and lists no block itself', () => {
		const lines = [
			"describe('board', () => {",
			"\tdescribe('usage', () => {",
			`\t\tit('${LEAF}', () => {})`,
			`\t${CLOSE_BLOCK}`,
			"\ttest('prints a row', () => {})",
			CLOSE_BLOCK,
			`it('${STANDS_ALONE}', () => {})`,
		]

		expect(titles(lines)).toStrictEqual([FULL_NAME, 'board > prints a row', STANDS_ALONE])
	})

	it('reads a modified call as the same test, and the case table of `.each` as no title', () => {
		const lines = [
			"describe.concurrent('block', () => {",
			"\tit.skip('skipped', () => {})",
			"\tit.each([[1], [2]])('case %s', () => {})",
			CLOSE_BLOCK,
		]

		expect(titles(lines)).toStrictEqual(['block > skipped', 'block > case %s'])
	})

	it('keeps a title holding quotes, and a template with substitutions as its source', () => {
		const template = '`counts ${String(LANES)} lanes`'
		const lines = [
			String.raw`it("reads the frame’s \"running\" rows", () => {})`,
			`it(${template}, () => {})`,
			'it(NAME, () => {})',
			"expect(value).toBe('not a test')",
		]

		expect(titles(lines)).toStrictEqual(['reads the frame’s "running" rows', template])
	})
})

describe('test_titles.titles_of — Playwright calls', () => {
	it('reads `test.describe` as a block and `test.step` as part of its test', () => {
		const lines = [
			"test.describe.parallel('auth', () => {",
			"\ttest('signs in', async () => {",
			"\t\tawait test.step('opens the form', async () => {})",
			`\t${CLOSE_BLOCK}`,
			CLOSE_BLOCK,
		]

		expect(titles(lines)).toStrictEqual(['auth > signs in'])
	})
})

describe('test_titles.leaf_of', () => {
	it('is the title the test carries itself', () => {
		expect(test_titles.leaf_of(FULL_NAME)).toBe(LEAF)
		expect(test_titles.leaf_of(STANDS_ALONE)).toBe(STANDS_ALONE)
	})
})
