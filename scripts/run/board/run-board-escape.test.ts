import { describe, expect, it } from 'vitest'
import { run_board_escape } from './run-board-escape'

// joshuafolkken/kit#8567: a board line's escapes, tmux's passthrough-wrapped link among them.

const ESC = '\u{1B}'
const BEL = '\u{7}'
const ST = `${ESC}\\`
const DCS = `${ESC}P`
const DOUBLED_ESC = `${ESC}${ESC}`

// A sequence wrapped as `terminal-link` wraps it inside tmux: every ESC doubled.
function tmux_wrapped(sequence: string): string {
	return `${DCS}tmux;${sequence.replaceAll(ESC, () => DOUBLED_ESC)}${ST}`
}

const LINK_OPEN = `${ESC}]8;id=josh-run-board;https://a.b/c${BEL}`
const LINK_CLOSE = `${ESC}]8;;${BEL}`

describe('run_board_escape.LINE_ESCAPE', () => {
	it.each([
		{ name: 'a color', escape: `${ESC}[1;32m` },
		{ name: 'a link ended by BEL', escape: LINK_OPEN },
		{ name: 'a link ended by ST', escape: `${ESC}]8;;https://a.b/c${ST}` },
		{ name: 'a tmux-wrapped link', escape: tmux_wrapped(LINK_OPEN) },
	])('splits $name out as one escape', ({ escape }) => {
		expect(`a${escape}b`.split(run_board_escape.LINE_ESCAPE)).toEqual(['a', escape, 'b'])
	})
})

describe('run_board_escape.FRAME_ESCAPE', () => {
	it('splits a cursor move and a tmux-wrapped link out whole', () => {
		const wrapped = tmux_wrapped(LINK_OPEN)
		const frame = `${ESC}[2;5Hx${wrapped}y`

		expect(frame.split(run_board_escape.FRAME_ESCAPE)).toEqual([
			'',
			`${ESC}[2;5H`,
			'x',
			wrapped,
			'y',
		])
	})
})

describe('run_board_escape link escapes', () => {
	const { is_link, is_link_open, link_close_for } = run_board_escape

	it('reads a link’s opening and closing escape, tmux-wrapped or not', () => {
		expect([LINK_OPEN, tmux_wrapped(LINK_OPEN)].map((escape) => is_link_open(escape))).toEqual([
			true,
			true,
		])
		expect([LINK_CLOSE, tmux_wrapped(LINK_CLOSE)].map((escape) => is_link_open(escape))).toEqual([
			false,
			false,
		])
		expect(is_link(tmux_wrapped(LINK_CLOSE))).toBe(true)
		expect(is_link(`${ESC}[32m`)).toBe(false)
	})

	it('closes a link wrapped as its opening is', () => {
		expect(link_close_for(LINK_OPEN)).toBe(LINK_CLOSE)
		expect(link_close_for(tmux_wrapped(LINK_OPEN))).toBe(tmux_wrapped(LINK_CLOSE))
	})
})
