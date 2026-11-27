import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_analysis } from './run-board-theme-deviant-analysis'
import { run_board_theme_deviant_fixture } from './run-board-theme-deviant-fixture'
import { run_board_theme_draw } from './run-board-theme-draw'

// joshuafolkken/kit#9096: the deviant theme's PROGRESS — the clue analysis in the panel, scan mode
// on the board and the brackets hopping over the data.

const { analysis, hopping_brackets, is_analyzing, scan_mode, scan_share } =
	run_board_theme_deviant_analysis
const { HOST, draw_at, fresh_grid, panel_text, row_text, state_at } =
	run_board_theme_deviant_fixture
const { data_pane } = run_board_theme_draw
// The demo's PROGRESS line starts typing on tick 10.
const START = 10
const TYPING = START + 20

describe('run_board_theme_deviant_analysis.is_analyzing', () => {
	it('is analyzing while a progress line types, not while idle', () => {
		expect([
			is_analyzing(state_at('p', TYPING)),
			is_analyzing(state_at('i', TYPING)),
		]).toStrictEqual([true, false])
	})
})

describe('run_board_theme_deviant_analysis.scan_share', () => {
	it('eases in as the line starts and back out once it has typed', () => {
		const { progress } = state_at('p', TYPING)
		const typing = { ...progress, is_typing: true, start: START }
		const typed = { ...progress, is_typing: false }

		expect([START, START + 4, START + 8].map((tick) => scan_share(typing, tick))).toStrictEqual([
			0, 0.5, 1,
		])
		expect([0, 6, 12].map((cooled) => scan_share({ ...typed, cooled }, 0))).toStrictEqual([
			1, 0.5, 0,
		])
	})
})

describe('run_board_theme_deviant_analysis.analysis', () => {
	it('shows the plate, the subject, the sync label and the tally in the panel', () => {
		const draw = draw_at('p', TYPING)

		analysis(draw)

		expect(panel_text(draw.grid, 0)).toContain('⌜ ANALYZE ⌟')
		expect(panel_text(draw.grid, 0)).toContain('HOLD △ TO ANALYZE')
		expect(panel_text(draw.grid, 1)).toContain('pnpm josh gate --changed')
		expect(panel_text(draw.grid, 3)).toContain('SYNC DONE')
		expect(panel_text(draw.grid, 5)).toContain('CLUES TO ANALYZE')
	})
})

describe('run_board_theme_deviant_analysis.scan_mode', () => {
	it('restyles the board’s text under the header and leaves the header alone', () => {
		const draw = draw_at('p', TYPING)

		scan_mode(draw)

		expect(draw.grid[0]).toStrictEqual(HOST.board[0])
		expect(draw.grid[5]).not.toStrictEqual(HOST.board[5])
		expect(row_text(draw.grid, 5)).toBe(row_text(HOST.board, 5))
	})
})

describe('run_board_theme_deviant_analysis.hopping_brackets', () => {
	it('puts reticle brackets on the data while the line types', () => {
		const draw = draw_at('p', TYPING)
		const { box } = data_pane(draw)

		hopping_brackets(draw)

		const rows = Array.from({ length: box.h }, (_, index) => row_text(draw.grid, box.y + index))

		expect(rows.join('')).toContain('⌜')
	})

	it('leaves the board alone while idle', () => {
		const draw = draw_at('i', TYPING)

		hopping_brackets(draw)
		expect(draw.grid).toStrictEqual(fresh_grid())
	})
})
