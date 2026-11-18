import { describe, expect, it } from 'vitest'
import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#8003: a row's key rides its text from where it is drawn to where its place is
// recorded, and comes out whole.

const { keyed, split_key, without_key } = run_board_row_key
const INDENT = '  '
const ROW = '#7 a title'

describe('run_board_row_key', () => {
	it('gives back the key and the row it led, the indent before it kept', () => {
		const line = `${INDENT}${keyed('done', 7, ROW)}`

		expect(split_key(line)).toStrictEqual({ key: 'done:7', text: `${INDENT}${ROW}` })
		expect(without_key(line)).toBe(`${INDENT}${ROW}`)
	})

	it('leaves a row whose section names no key as it is', () => {
		expect(keyed(undefined, 7, ROW)).toBe(ROW)
		expect(split_key(ROW)).toStrictEqual({ key: undefined, text: ROW })
	})
})
