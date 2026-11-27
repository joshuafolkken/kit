import { describe, expect, it } from 'vitest'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_rk800_fixture } from './run-board-theme-rk800-fixture'
import { run_board_theme_rk800_opening } from './run-board-theme-rk800-opening'
import { run_board_theme_rk800_results } from './run-board-theme-rk800-results'

// joshuafolkken/kit#9096: the rk800 theme's results screen in the ENDING — the title, MISSION
// SUCCESSFUL and the run's own numbers on the light bars.

const { results } = run_board_theme_rk800_results
const { ice_at } = run_board_theme_rk800_opening
const { bg } = run_board_theme_host_grid
const { draw_at, row_text } = run_board_theme_rk800_fixture
// The rows of the title, its status line and the figures' captions.
const TITLE_ROW = 2
const STATUS_ROW = 3
const CAPTION_ROW = 8
const FIRST_FIGURE = 40
const ALL_FIGURES = 80

describe('run_board_theme_rk800_results.results', () => {
	it('lays the title and its status line, then the first figure', () => {
		const draw = draw_at('i', 0)

		results(draw, FIRST_FIGURE)

		expect(row_text(draw.grid, TITLE_ROW)).toContain('J O S H - R K 8 0 0')
		expect(row_text(draw.grid, STATUS_ROW)).toContain('MISSION SUCCESSFUL')
		expect(row_text(draw.grid, CAPTION_ROW).trim()).toBe('LANES')
	})

	it('shows the board’s lanes, those running and the events once every figure is in', () => {
		const draw = draw_at('i', 0)

		results(draw, ALL_FIGURES)
		expect(row_text(draw.grid, CAPTION_ROW)).toMatch(/LANES +RUNNING +EVENTS/u)
	})

	it('leaves the light bars empty before the title fades in', () => {
		const draw = draw_at('i', 0)

		results(draw, 0)

		expect(draw.grid.every((row) => row.every(([ch]) => ch === ' '))).toBe(true)
		expect(draw.grid[0]?.[0]?.[1]).toBe(bg(ice_at(0, 1)))
	})
})
