import { describe, expect, it } from 'vitest'
import { run_board_screen } from './run-board-screen'

// joshuafolkken/kit#3441: a board kept open on a terminal draws on the alternate screen and restores
// the screen it found; one frame, or a pipe, carries no control bytes at all.

const ESCAPE = '\u{1B}'

describe('run_board_screen.mode_of', () => {
	it.each([
		{ is_tty: true, is_once: false, mode: 'live' },
		{ is_tty: true, is_once: true, mode: 'plain' },
		{ is_tty: false, is_once: false, mode: 'plain' },
		{ is_tty: false, is_once: true, mode: 'plain' },
	] as const)('is $mode for tty $is_tty and once $is_once', ({ is_tty, is_once, mode }) => {
		expect(run_board_screen.mode_of({ is_tty, is_once })).toBe(mode)
	})
})

describe('run_board_screen.screen_of', () => {
	it('enters the alternate screen with the cursor hidden and leaves in the reverse order', () => {
		expect(run_board_screen.screen_of('live')).toStrictEqual({
			enter: `${ESCAPE}[?1049h${ESCAPE}[?25l`,
			frame: `${ESCAPE}[H${ESCAPE}[J`,
			leave: `${ESCAPE}[?25h${ESCAPE}[?1049l`,
		})
	})

	it('writes no control bytes in plain mode', () => {
		const screen = run_board_screen.screen_of('plain')

		expect(Object.values(screen).join('')).toBe('')
	})
})
