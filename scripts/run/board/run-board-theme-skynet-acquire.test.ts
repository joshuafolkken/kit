import { describe, expect, it } from 'vitest'
import { run_board_theme_skynet_acquire } from './run-board-theme-skynet-acquire'
import { run_board_theme_skynet_fixture } from './run-board-theme-skynet-fixture'

// joshuafolkken/kit#8917: the TERMINATOR theme's ROW screen, target acquisition.

const { acquisition } = run_board_theme_skynet_acquire
const { HOST, draw_at, row_text } = run_board_theme_skynet_fixture
const CONFIRMED = ' ID CONFIRMED '

describe('run_board_theme_skynet_acquire', () => {
	it('titles the area while the lane types', () => {
		const draw = draw_at('r', 12)

		acquisition(draw)

		expect(row_text(draw.grid, HOST.layout.area_top)).toContain('TARGET ACQUISITION')
		expect(row_text(draw.grid, HOST.layout.area_end)).not.toContain(CONFIRMED)
	})

	it('confirms the id once the lane has typed', () => {
		const draw = draw_at('r', 10 + draw_at('r', 10).s.row.total + 2)

		acquisition(draw)

		expect(row_text(draw.grid, HOST.layout.area_top)).toContain('COMPLETE')
		expect(row_text(draw.grid, HOST.layout.area_end)).toContain(CONFIRMED)
		expect(row_text(draw.grid, 10)).toContain('100.0%')
	})
})
