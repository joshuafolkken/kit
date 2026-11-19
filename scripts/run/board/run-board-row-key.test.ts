import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#8003: a row's key rides its text from where it is drawn to where its place is
// recorded, comes out whole and takes no column.

const { keyed, split_key, without_key } = run_board_row_key
const INDENT = '  '
const ROW = '#7 a title'
const GREEN = '\u{1B}[32m'
const WRAP_COLUMNS = 22

describe('run_board_row_key', () => {
	it('gives back the key and the row it led, the indent before it kept', () => {
		const line = `${INDENT}${keyed('done', 7, ROW)}`

		expect(split_key(line)).toStrictEqual({
			key: 'done:7',
			text: `${INDENT}${ROW}`,
			prefix: INDENT,
		})
		expect(without_key(line)).toBe(`${INDENT}${ROW}`)
	})

	it('leaves a row whose section names no key as it is', () => {
		expect(keyed(undefined, 7, ROW)).toBe(ROW)
		expect(split_key(ROW)).toStrictEqual({ key: undefined, text: ROW, prefix: '' })
	})

	it('keys the now line by its words, the time before them a prefix (joshuafolkken/kit#8103)', () => {
		const prefix = `${GREEN}KIT  5″  > `
		const words = '#8093 · WRITE'
		const line = `${prefix}${keyed('now', words, words)}`

		expect(split_key(line)).toStrictEqual({
			key: `now:${words}`,
			text: `${prefix}${words}`,
			prefix,
		})
		expect(run_board_fit.width_of(line)).toBe(run_board_fit.width_of(`${prefix}${words}`))
	})

	it('takes no column, so a keyed row wraps where the row alone does', () => {
		const line = `${GREEN}✅ ${'x'.repeat(20)}`
		const key = keyed('lanes', 8003, line)

		expect(run_board_fit.width_of(key)).toBe(run_board_fit.width_of(line))
		expect(run_board_fit.height_of(key, WRAP_COLUMNS)).toBe(
			run_board_fit.height_of(line, WRAP_COLUMNS),
		)
	})
})
