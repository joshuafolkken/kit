import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_led } from './run-board-theme-deviant-led'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import type { ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#9096: the deviant theme's lanes as LEDs — a mark in its role's LED, a running
// lane's ring yellow, every other cell left as the host laid it.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { SPINNER, leds } = run_board_theme_deviant_led
const { RGB } = run_board_theme_deviant_data
const { bold } = run_board_theme_deviant_parts
// The demo's first lane row carries an `ok` mark (`SH`) five columns in; its second a `hi` one.
const OK_ROW = 14
const HI_ROW = 15
const MARK_X = 5

function board_copy(): Grid {
	return HOST.board.map((row) => row.map((cell): Cell => [cell[0], cell[1]]))
}

function draw_of(grid: Grid): ThemeDraw {
	return { api: HOST.api, grid, s: state_of(HOST.layout, HOST.events.i, 0), tick: 0 }
}

describe('run_board_theme_deviant_led.leds', () => {
	it('lights an ok mark blue and keeps its letters', () => {
		const grid = board_copy()

		leds(draw_of(grid))
		expect(grid[OK_ROW]?.slice(MARK_X, MARK_X + 2)).toStrictEqual([
			['S', bold(RGB.blue)],
			['H', bold(RGB.blue)],
		])
	})

	it('leaves a mark in a role with no LED as the host laid it', () => {
		const grid = board_copy()

		leds(draw_of(grid))
		expect(grid[HI_ROW]).toStrictEqual(HOST.board[HI_ROW])
	})

	it('turns a running lane ring yellow where the host laid a spinner glyph', () => {
		const grid = board_copy()
		const at = HOST.layout.lane_spin_x
		const [glyph = ''] = [...SPINNER]
		const row = grid[OK_ROW] ?? []

		row[at] = [glyph, 'body']
		leds(draw_of(grid))
		expect(row[at]).toStrictEqual([glyph, bold(RGB.yellow)])
	})

	it('leaves a ring cell alone that holds no spinner glyph', () => {
		const grid = board_copy()
		const at = HOST.layout.lane_spin_x
		const row = grid[OK_ROW] ?? []

		row[at] = ['x', 'body']
		leds(draw_of(grid))
		expect(row[at]).toStrictEqual(['x', 'body'])
	})
})
