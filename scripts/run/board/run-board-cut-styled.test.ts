import { describe, expect, it } from 'vitest'
import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_fit } from './run-board-fit'
import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#8003: a drawn line cut to its first columns with its colors and links kept, and a
// row's key that takes no column.

const { cut_styled } = run_board_cut_styled
const ESC = '\u{1B}'
const BEL = '\u{7}'
const GREEN = `${ESC}[32m`
const DEFAULT = `${ESC}[39m`
const RESET = `${ESC}[0m`
const LINK_CLOSE = `${ESC}]8;;${BEL}`

function linked(text: string): string {
	return `${ESC}]8;;https://example.com/7${BEL}${text}${LINK_CLOSE}`
}

describe('run_board_cut_styled.cut_styled', () => {
	it('cuts a plain line to its first columns and resets the colors after it', () => {
		expect(cut_styled('abcdef', 3)).toBe(`abc${RESET}`)
	})

	it('keeps the colors opened before the cut, counting no column for them', () => {
		const line = `a${GREEN}bcd${DEFAULT}ef`

		expect(cut_styled(line, 3)).toBe(`a${GREEN}bc${RESET}`)
		expect(run_board_fit.width_of(cut_styled(line, 3))).toBe(3)
	})

	it('keeps a link’s opening escape and closes the link the cut leaves open', () => {
		const line = `✅ ${linked('7988')} title`

		expect(cut_styled(line, 5)).toBe(
			`✅ ${ESC}]8;;https://example.com/7${BEL}79${LINK_CLOSE}${RESET}`,
		)
	})

	it('leaves out a character two columns wide that the cut would split', () => {
		expect(cut_styled('a✅b', 2)).toBe(`a${RESET}`)
		expect(cut_styled('a✅b', 3)).toBe(`a✅${RESET}`)
	})

	it('cuts nothing off a line no wider than the columns', () => {
		expect(cut_styled(`${GREEN}ab${DEFAULT}`, 5)).toBe(`${GREEN}ab${DEFAULT}${RESET}`)
	})
})

describe('run_board_row_key', () => {
	const { keyed, split_key, without_key } = run_board_row_key

	it('leads a row with its section and number, read back and taken out whole', () => {
		const line = keyed('done', 7988, `${GREEN}✅ 7988`)

		expect(split_key(line)).toStrictEqual({ key: 'done:7988', text: `${GREEN}✅ 7988` })
		expect(without_key(line)).toBe(`${GREEN}✅ 7988`)
	})

	it('keys no row where its section names none, and reads no key in a line without one', () => {
		expect(keyed(undefined, 7, 'row')).toBe('row')
		expect(split_key('row')).toStrictEqual({ key: undefined, text: 'row' })
	})

	it('takes no column, so a keyed row wraps where the row alone does', () => {
		const line = `${GREEN}✅ ${'x'.repeat(20)}`
		const key = keyed('lanes', 8003, line)

		expect(run_board_fit.width_of(key)).toBe(run_board_fit.width_of(line))
		expect(run_board_fit.height_of(key, 22)).toBe(run_board_fit.height_of(line, 22))
	})
})
