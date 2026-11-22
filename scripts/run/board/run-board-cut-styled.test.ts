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

const LINK_OPEN = `${ESC}]8;id=josh-run-board;https://example.com/7${BEL}`

// An escape wrapped as `terminal-link` wraps it inside tmux: every ESC doubled.
const DCS = `${ESC}P`
const DOUBLED_ESC = `${ESC}${ESC}`

function tmux_wrapped(sequence: string): string {
	return `${DCS}tmux;${sequence.replaceAll(ESC, () => DOUBLED_ESC)}${ESC}\\`
}

function linked(text: string): string {
	return `${ESC}]8;;https://example.com/7${BEL}${text}${LINK_CLOSE}`
}

// joshuafolkken/kit#8367: each character with the colors holding at it, for the drop to put a cell back.
describe('run_board_cut_styled.styled_pieces', () => {
	const { styled_pieces } = run_board_cut_styled

	it('gives each character the color escapes written since the last reset before it', () => {
		const line = `a${GREEN}b${RESET}c`

		expect(styled_pieces(line)).toEqual([
			{ text: 'a', width: 1, style: '' },
			{ text: 'b', width: 1, style: GREEN },
			{ text: 'c', width: 1, style: '' },
		])
	})

	it('stacks escapes until a reset and counts a wide character as two columns', () => {
		const pieces = styled_pieces(`${GREEN}${DEFAULT}日${ESC}[mx`)

		expect(pieces).toEqual([
			{ text: '日', width: 2, style: `${GREEN}${DEFAULT}` },
			{ text: 'x', width: 1, style: '' },
		])
	})

	it('leaves the colors holding across a link’s escapes', () => {
		const pieces = styled_pieces(`${GREEN}${linked('7')}`)

		expect(pieces.map((piece) => piece.style)).toEqual([GREEN])
	})

	// joshuafolkken/kit#8353: a flashed glyph is rewritten inside the link it was drawn in.
	it('gives each character the link open at it and none once the link closes', () => {
		const pieces = styled_pieces(`${linked('7')}x`)

		expect(pieces.map((piece) => piece.link)).toEqual([
			`${ESC}]8;;https://example.com/7${BEL}`,
			undefined,
		])
	})
})

describe('run_board_cut_styled.cut_styled', () => {
	// joshuafolkken/kit#8632: a line with no escape is cut with none added.
	it('cuts a plain line to its first columns with no escape added', () => {
		expect(cut_styled('abcdef', 3)).toBe('abc')
	})

	it('resets the colors after a cut of a colored line', () => {
		expect(cut_styled(`${GREEN}abcdef`, 3)).toBe(`${GREEN}abc${RESET}`)
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

	it('adds no close after a link the cut kept whole', () => {
		const line = `${linked('79')} title`

		expect(cut_styled(line, 4)).toBe(`${linked('79')} t${RESET}`)
	})

	it('leaves out a character two columns wide that the cut would split', () => {
		expect(cut_styled('a✅b', 2)).toBe('a')
		expect(cut_styled('a✅b', 3)).toBe('a✅')
	})

	it('cuts nothing off a line no wider than the columns', () => {
		expect(cut_styled(`${GREEN}ab${DEFAULT}`, 5)).toBe(`${GREEN}ab${DEFAULT}${RESET}`)
	})
})

// joshuafolkken/kit#8567: inside tmux `terminal-link` wraps each link escape in tmux's passthrough.
describe('run_board_cut_styled with a tmux-wrapped link', () => {
	it('keeps the link whole, counts no column for it and closes it wrapped', () => {
		const line = `IS ${tmux_wrapped(LINK_OPEN)}4566${tmux_wrapped(LINK_CLOSE)} x`
		const cut = cut_styled(line, 5)

		expect(cut).toBe(`IS ${tmux_wrapped(LINK_OPEN)}45${tmux_wrapped(LINK_CLOSE)}${RESET}`)
		expect(
			run_board_cut_styled.pieces_of(line).reduce((columns, piece) => columns + piece.width, 0),
		).toBe('IS 4566 x'.length)
		expect(run_board_cut_styled.tail_styled(line, 5)).toBe(
			`${tmux_wrapped(LINK_OPEN)}66${tmux_wrapped(LINK_CLOSE)} x${RESET}`,
		)
		expect(
			run_board_cut_styled
				.styled_pieces(line)
				.map((piece) => piece.text)
				.join(''),
		).toBe('IS 4566 x')
	})
})

// joshuafolkken/kit#8457: the saved line right of a typing row's block.
describe('run_board_cut_styled.tail_styled', () => {
	const { tail_styled } = run_board_cut_styled

	it('drops a plain line’s first columns with no escape added', () => {
		expect(tail_styled('abcdef', 3)).toBe('def')
	})

	it('resets the colors after the tail of a colored line', () => {
		expect(tail_styled(`${GREEN}abcdef`, 3)).toBe(`${GREEN}def${RESET}`)
	})

	it('keeps the colors opened before the dropped columns, so the tail draws as the line did', () => {
		expect(tail_styled(`a${GREEN}bcd${DEFAULT}ef`, 2)).toBe(`${GREEN}cd${DEFAULT}ef${RESET}`)
	})

	it('draws blanks for the part of a character two columns wide the cut splits', () => {
		expect(tail_styled('a✅b', 2)).toBe(' b')
		expect(tail_styled('a✅b', 3)).toBe('b')
	})

	it('keeps nothing of a line no wider than the columns but its escapes', () => {
		expect(tail_styled(`${GREEN}ab${DEFAULT}`, 5)).toBe(`${GREEN}${DEFAULT}${RESET}`)
	})
})
