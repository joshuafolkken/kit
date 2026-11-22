import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#8003: a row's key rides its text from where it is drawn to where its place is
// recorded, comes out whole and takes no column.

const { keyed, rekeyed, split_key, without_key } = run_board_row_key
const INDENT = '  '
const PIN = '    ✅ 8505 10:18'
const ROW = '#7 a title'
const GREEN = '\u{1B}[32m'
const WRAP_COLUMNS = 22

describe('run_board_row_key flash metadata', () => {
	it('moves flash identity past appended lamps while preserving typing identity', () => {
		const line = `${run_board_row_key.flashed(ROW, 'usage:claude', true)} lamps`
		const text = `${ROW} lamps`

		expect(split_key(run_board_row_key.trailing_flash(line))).toStrictEqual({
			key: 'flash:usage:claude',
			text,
			prefix: text,
			suffix: '',
		})
		expect(run_board_row_key.trailing_flash(keyed('lanes', 7, ROW))).toBe(keyed('lanes', 7, ROW))
		expect(run_board_row_key.trailing_flash(ROW)).toBe(ROW)
	})

	it('leaves a line already keyed with its own key, so the line reads one key', () => {
		const line = `rule ${keyed('plan', 'progress', '🎯 1/2')}`
		const id = 'head:lanes:1'

		expect(run_board_row_key.flashed(line, id, true)).toBe(line)
		expect(split_key(run_board_row_key.flashed(line, id, true)).key).toBe('plan:progress')
		expect(run_board_row_key.flashed(ROW, id)).toBe(ROW)
	})
})

describe('run_board_row_key', () => {
	it('gives back the key and the row it led, the indent before it kept', () => {
		const line = `${INDENT}${keyed('done', 7, ROW)}`

		expect(split_key(line)).toStrictEqual({
			key: 'done:7',
			text: `${INDENT}${ROW}`,
			prefix: INDENT,
			suffix: '',
		})
		expect(without_key(line)).toBe(`${INDENT}${ROW}`)
	})

	it('leaves a row whose section names no key as it is', () => {
		expect(keyed(undefined, 7, ROW)).toBe(ROW)
		expect(split_key(ROW)).toStrictEqual({ key: undefined, text: ROW, prefix: '', suffix: '' })
	})
})

describe('run_board_row_key end mark (joshuafolkken/kit#8607)', () => {
	it('ends the typed text at the end mark, the rest a suffix drawn whole', () => {
		const line = rekeyed(`${INDENT}${keyed('now', 7, ROW)}`, `${INDENT}#7`, PIN)

		expect(split_key(line)).toStrictEqual({
			key: 'now:7',
			text: `${INDENT}#7`,
			prefix: INDENT,
			suffix: PIN,
		})
		expect(without_key(line)).toBe(`${INDENT}#7${PIN}`)
		expect(run_board_fit.width_of(line)).toBe(run_board_fit.width_of(`${INDENT}#7${PIN}`))
	})

	it('puts the suffix straight after a line with no key', () => {
		expect(rekeyed(ROW, ROW, PIN)).toBe(`${ROW}${PIN}`)
	})
})

describe('run_board_row_key on the header and in the fit', () => {
	it('keys the now line by its words, the time before them a prefix (joshuafolkken/kit#8103)', () => {
		const prefix = `${GREEN}KIT  5″  > `
		const words = '#8093 · WRITE'
		const line = `${prefix}${keyed('now', words, words)}`

		expect(split_key(line)).toStrictEqual({
			key: `now:${words}`,
			text: `${prefix}${words}`,
			prefix,
			suffix: '',
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
