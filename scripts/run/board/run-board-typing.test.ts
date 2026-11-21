import { describe, expect, it } from 'vitest'
import { run_board_typing } from './run-board-typing'

// joshuafolkken/kit#8000: a line being typed shows a block cursor after what is typed so far, and
// drops it once the whole line is out.

const { CURSOR, typed } = run_board_typing
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

// joshuafolkken/kit#8402: the block no longer blinks, so typing takes no clock and keeps no beat.
describe('run_board_typing — no blink', () => {
	it('exposes only the block and the typing, no blink beat', () => {
		expect(Object.keys(run_board_typing)).toStrictEqual(['CURSOR', 'typed'])
	})

	it('takes the text and the part shown, and no clock', () => {
		expect(typed).toHaveLength(2)
	})
})
