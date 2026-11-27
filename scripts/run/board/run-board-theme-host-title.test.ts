import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_frame } from './run-board-theme-host-frame'
import type { Cell, ThemeApi, ThemeModule } from './run-board-theme-host-types'

// joshuafolkken/kit#9023: the board's name takes one style across all its letters, also the ones
// past where the original board's own name ended.

const { HOST } = run_board_theme_host_fixture
const NAME_X = 2
const BRIGHT = '255;240;220'
const COLORS = {
	body: '255;150;30',
	rule: '140;70;0',
	ok: '120;255;150',
	red: '255;50;40',
	warn: '255;210;0',
	hi: BRIGHT,
	type: '255;235;200',
	notice: BRIGHT,
}

const IDLE = { notice: [], progress: [], row: [] }
// A name longer than the original board's own.
const LONG_NAME = 'josh-probe-long'

function title_styles(board: string): Array<string> {
	const theme: ThemeModule = { name: 'PROBE', board, colors: COLORS, draw: () => undefined }
	const frame = run_board_theme_host_frame.frame_of(theme, HOST.api, IDLE, 0)
	const row = frame[0] ?? []

	return row.slice(NAME_X, NAME_X + board.length).map((cell) => cell[1])
}

// The base with its run waiting on a person: ✋ as a theme draws it, two letters and a blank, its name
// one column further right.
function waiting_api(): ThemeApi {
	const [first = [], ...rest] = HOST.api.board
	const mark: Array<Cell> = [
		['H', 'body'],
		['U', 'body'],
		[' ', 'body'],
	]

	return { ...HOST.api, board: [[...mark, ...first.slice(NAME_X)], ...rest] }
}

// The first row's text of the frame `board` names over `api`.
function title_text(api: ThemeApi, board: string): string {
	const theme: ThemeModule = { name: 'PROBE', board, colors: COLORS, draw: () => undefined }
	const frame = run_board_theme_host_frame.frame_of(theme, api, IDLE, 0)

	return (frame[0] ?? []).map((cell) => cell[0]).join('')
}

describe('board name place', () => {
	it('draws the name on the base’s own, two columns in after a one-column mark', () => {
		expect(title_text(HOST.api, LONG_NAME).slice(NAME_X).startsWith(LONG_NAME)).toBe(true)
	})

	// A two-column mark moved the base's name a column right: the theme's name drawn at the usual
	// column left the mark touching it and the base's last letter after it (`HUjosh-detroitt`).
	it('draws the name a column further right after a two-column mark', () => {
		expect(title_text(waiting_api(), LONG_NAME).startsWith(`HU ${LONG_NAME}`)).toBe(true)
	})
})

describe('board name style', () => {
	it('paints a name longer than the original board name in one style', () => {
		expect(new Set(title_styles(LONG_NAME)).size).toBe(1)
	})

	it('paints a name as long as the original board name in one style', () => {
		expect(new Set(title_styles('josh-trace')).size).toBe(1)
	})
})
