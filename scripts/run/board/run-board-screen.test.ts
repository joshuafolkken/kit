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
	// joshuafolkken/kit#8653: entering puts the cursor on the second row, so the intro lands there
	// wherever the shell left it.
	it('enters the alternate screen with the cursor hidden and leaves in the reverse order', () => {
		const screen = run_board_screen.screen_of('live')

		expect([screen.enter, screen.leave]).toStrictEqual([
			`${ESCAPE}[?1049h${ESCAPE}[?25l${ESCAPE}[2;1H`,
			`${ESCAPE}[?25h${ESCAPE}[?1049l`,
		])
	})

	it('writes no control bytes in plain mode', () => {
		const screen = run_board_screen.screen_of('plain')

		expect([screen.enter, screen.leave, screen.frame('a\nb'), screen.held('a\nb')]).toStrictEqual([
			'',
			'',
			'a\nb',
			'a\nb',
		])
	})
})

// joshuafolkken/kit#8125: a frame is written over the last one in one synchronized write, never after
// a cleared screen.
const SYNC_ON = `${ESCAPE}[?2026h`
const SYNC_OFF = `${ESCAPE}[?2026l`
const HOME = `${ESCAPE}[H`
const ERASE_LINE = `${ESCAPE}[K`
const ERASE_BELOW = `${ESCAPE}[J`

describe('run_board_screen — a live frame', () => {
	const { frame, held } = run_board_screen.screen_of('live')

	it('wraps the frame in synchronized output, from the top, each line erased as written', () => {
		expect(frame('one\ntwo\nthree')).toBe(
			`${SYNC_ON}${HOME}${ERASE_LINE}one\n${ERASE_LINE}two\n${ERASE_BELOW}three${SYNC_OFF}`,
		)
	})

	it('clears no screen before the frame', () => {
		expect(frame('one\ntwo')).not.toContain(`${HOME}${ERASE_BELOW}`)
	})

	it('erases every row below its last line, so a shorter frame leaves none of the longer one', () => {
		const shorter = frame('one')

		expect(shorter.endsWith(`${ERASE_BELOW}one${SYNC_OFF}`)).toBe(true)
	})

	it('writes a held frame after a wiped screen, without synchronized output, so it reveals a line at a time', () => {
		expect(held('one\ntwo')).toBe(`${HOME}${ERASE_BELOW}one\ntwo`)
	})
})

describe('run_board_screen.synced', () => {
	it('wraps bytes in synchronized output', () => {
		expect(run_board_screen.synced('x')).toBe(`${SYNC_ON}x${SYNC_OFF}`)
	})

	it('writes nothing for nothing', () => {
		expect(run_board_screen.synced('')).toBe('')
	})
})
