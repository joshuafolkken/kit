import { describe, expect, it } from 'vitest'
import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_fit } from './run-board-fit'

// joshuafolkken/kit#8003: a drawn line cut to its first columns with its colors and links kept.

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
