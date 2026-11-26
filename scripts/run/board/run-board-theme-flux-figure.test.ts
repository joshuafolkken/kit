import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_figure } from './run-board-theme-flux-figure'
import { run_board_theme_flux_fixture } from './run-board-theme-flux-fixture'

// joshuafolkken/kit#8917: the BTTF theme draws the capacitor and the gauge, and the speed in an event.

const { draw_figure, draw_speed, speed_line } = run_board_theme_flux_figure
const { CONTEXT, HOST, board_grid, moment_at, row_text } = run_board_theme_flux_fixture
const { area_end, px } = HOST.layout

describe('run_board_theme_flux_figure', () => {
	it('draws the capacitor’s red bar on the figure’s sixth row, a lamp on its middle', () => {
		const grid = board_grid()
		const { motion, tick } = moment_at('i', 30)
		const { column, row } = CONTEXT.figure

		draw_figure(CONTEXT, grid, motion, tick)

		expect(row_text(grid, row + 5).slice(column + 2, column + 11)).toMatch(/^━{4}[●∙]━{4}$/u)
	})

	it('writes the speed, at most 88', () => {
		const grid = board_grid()

		speed_line(CONTEXT, grid, 95, 1)

		expect(row_text(grid, area_end).slice(px, px + 14)).toBe('SPEED 88.0 MPH')
	})

	it('shows the speed during an event only', () => {
		const idle = board_grid()
		const typing = board_grid()

		draw_speed(CONTEXT, idle, moment_at('i', 30))
		draw_speed(CONTEXT, typing, moment_at('p', 30))

		expect(row_text(idle, area_end)).toBe(row_text(board_grid(), area_end))
		expect(row_text(typing, area_end).slice(px, px + 5)).toBe('SPEED')
	})
})
