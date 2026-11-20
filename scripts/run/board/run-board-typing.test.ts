import { describe, expect, it } from 'vitest'
import { run_board_typing } from './run-board-typing'

// joshuafolkken/kit#8000: a line being typed shows a block cursor after what is typed so far, and
// drops it once the whole line is out.

const { BLINK_MS, CURSOR, typed } = run_board_typing
const TEXT = 'SHALL'

describe('run_board_typing.typed', () => {
	it('trails a part-typed line with the cursor', () => {
		expect(typed(TEXT, 'SH')).toBe(`SH${CURSOR}`)
	})

	it('drops the cursor once the whole line is typed', () => {
		expect(typed(TEXT, TEXT)).toBe(TEXT)
	})

	it('shows only the cursor before the first letter', () => {
		expect(typed(TEXT, '')).toBe(CURSOR)
	})
})

// joshuafolkken/kit#8397: given the clock, the block is lit for one beat and a blank for the next.
describe('run_board_typing.typed on the clock', () => {
	it('lights the block on an even beat, from its first to its last moment', () => {
		expect(typed(TEXT, 'SH', 0)).toBe(`SH${CURSOR}`)
		expect(typed(TEXT, 'SH', BLINK_MS - 1)).toBe(`SH${CURSOR}`)
		expect(typed(TEXT, 'SH', 2 * BLINK_MS)).toBe(`SH${CURSOR}`)
	})

	it('draws a blank in the block’s place on an odd beat', () => {
		expect(typed(TEXT, 'SH', BLINK_MS)).toBe('SH ')
		expect(typed(TEXT, 'SH', 2 * BLINK_MS - 1)).toBe('SH ')
	})

	it('draws no block at all once the line is typed, on either beat', () => {
		expect(typed(TEXT, TEXT, BLINK_MS)).toBe(TEXT)
		expect(typed(TEXT, TEXT, 0)).toBe(TEXT)
	})
})
