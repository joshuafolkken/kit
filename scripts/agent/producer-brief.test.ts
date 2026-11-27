import { USAGE_ERROR_EXIT_CODE } from '#scripts/josh/josh-composite-arguments'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { producer_brief } from './producer-brief'

// 2026-11-28: the main line wrote "run the tests now" into its own producer brief. The standing part
// now comes from this command, and only the person's quoted words lift the deferral.

const NAME = 'theme'
const QUOTE_FLAG = '--tests-now-quote'
const BARE_FLAG = '--tests-now'
const USER_WORDS = 'テストと gate も'
const DEFERRED_LINE = 'they wait for the finish'
const FINISH_ITEM_LINE = 'report it as a finish item; do not fix it now'

function printed(): string {
	return vi.mocked(console.info).mock.calls.flat().join('\n')
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('producer_brief.run — the default brief', () => {
	it.each([
		'branch: wip/theme',
		'This branch carries every no-filing request of the session; a new branch only on the user’s instruction',
		'`pnpm josh git:checkpoint theme "<what>"`',
		'`.claude/agents/producer.md`',
		DEFERRED_LINE,
		FINISH_ITEM_LINE,
		'Never push, merge or open a pull request',
		'stop that step and report its exact text',
	])('prints the standing part: %s', (phrase) => {
		expect(producer_brief.run([NAME])).toBe(0)
		expect(printed()).toContain(phrase)
	})
})

describe('producer_brief.run — the user asked for the tests now', () => {
	it('replaces the deferral with the quoted request', () => {
		expect(producer_brief.run([NAME, QUOTE_FLAG, USER_WORDS])).toBe(0)
		expect(printed()).toContain(`The user asked for the tests and the gate now: "${USER_WORDS}"`)
		expect(printed()).toContain('the pre-commit review still waits for the finish')
		expect(printed()).not.toContain(DEFERRED_LINE)
		expect(printed()).not.toContain(FINISH_ITEM_LINE)
	})

	it.each([
		['the main line’s own wish', 'run tests, lint and the type check now'],
		['a deferral', 'テストと gate も後回しで'],
		['a quoted request', '「テストと gate も」'],
		['a blank quote', ' '],
	])('refuses %s and prints no brief', (_name, quote) => {
		expect(producer_brief.run([NAME, QUOTE_FLAG, quote])).toBe(1)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('is not a request'))
		expect(console.info).not.toHaveBeenCalled()
	})
})

describe('producer_brief.run — usage', () => {
	it.each([
		['no name', []],
		['a name with a slash', ['a/b']],
		['the flag without its value', [NAME, QUOTE_FLAG]],
		['a bare flag', [NAME, BARE_FLAG]],
		['an unknown flag with a value', [NAME, BARE_FLAG, USER_WORDS]],
		['an extra argument', [NAME, QUOTE_FLAG, USER_WORDS, 'more']],
	])('prints the usage for %s', (_name, argv) => {
		expect(producer_brief.run(argv)).toBe(USAGE_ERROR_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('usage:'))
		expect(console.info).not.toHaveBeenCalled()
	})
})
