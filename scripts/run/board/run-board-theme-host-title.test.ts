import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_frame } from './run-board-theme-host-frame'
import type { ThemeModule } from './run-board-theme-host-types'

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

function title_styles(board: string): Array<string> {
	const theme: ThemeModule = { name: 'PROBE', board, colors: COLORS, draw: () => undefined }
	const frame = run_board_theme_host_frame.frame_of(
		theme,
		HOST.api,
		{ notice: [], progress: [], row: [] },
		0,
	)
	const row = frame[0] ?? []

	return row.slice(NAME_X, NAME_X + board.length).map((cell) => cell[1])
}

describe('board name style', () => {
	it('paints a name longer than the original board name in one style', () => {
		expect(new Set(title_styles('josh-probe-long')).size).toBe(1)
	})

	it('paints a name as long as the original board name in one style', () => {
		expect(new Set(title_styles('josh-trace')).size).toBe(1)
	})
})
