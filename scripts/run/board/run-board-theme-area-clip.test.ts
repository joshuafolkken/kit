import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_clocks } from './run-board-theme-flux-clocks'
import { run_board_theme_flux_context } from './run-board-theme-flux-context'
import { run_board_theme_flux_figure } from './run-board-theme-flux-figure'
import { run_board_theme_flux_motion } from './run-board-theme-flux-motion'
import { run_board_theme_host_api } from './run-board-theme-host-api'
import { run_board_theme_host_sample } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, ThemeApi } from './run-board-theme-host-types'
import { run_board_theme_layout } from './run-board-theme-layout'
import { run_board_theme_roles } from './run-board-theme-roles'
import { run_board_theme_stress_fixture } from './run-board-theme-stress-fixture'
import { run_board_theme_wopr_idle } from './run-board-theme-wopr-idle'
import { run_board_theme_wopr_map } from './run-board-theme-wopr-map'
import { run_board_theme_wopr_panel } from './run-board-theme-wopr-panel'
import { run_board_theme_wopr_parts } from './run-board-theme-wopr-parts'
import { run_board_theme_wopr_place } from './run-board-theme-wopr-place'

// joshuafolkken/kit#8917: WARGAMES' and BTTF's panel parts are seven rows tall, as the demo's area is;
// on the smallest panel a theme is drawn on — six rows — each is cut at the area's last row, so the
// blank line under the panel and the next section's rule keep what the board wrote (BTTF's time
// circuits are six rows and fit it uncut). Each part is drawn alone here, apart from the themes'
// whole-screen effects, which may cross those rows by design.

const { MIN_PANEL_ROWS, MIN_PANEL_WIDTH, edit_board, layout_of } = run_board_theme_layout
const { plain_of, theme_api_of } = run_board_theme_host_api
const { state_of } = run_board_theme_host_state
const { demo_events } = run_board_theme_host_sample
// A live 200×50 board's rules and panel column, its panel six rows.
const SHORT = { columns: 200, rows: 50, edge: 118, px: 69, lanes: 1, panel_rows: MIN_PANEL_ROWS }
// The NOTICE's ticks sampled for its war screen; the ending's last tick before the rows leave.
const NOTICE_TICKS = Array.from({ length: 33 }, (_, index) => index * 10)
const LAMPS_OUT_TICK = 19

function api_of(): ThemeApi {
	const { cells, view, size } = run_board_theme_stress_fixture.stress_board(SHORT)
	const board = run_board_theme_roles.grid_of(cells)
	const layout = layout_of(view, board, size)

	if (layout === undefined) throw new Error('no layout on the short panel')
	edit_board(board, layout)

	return theme_api_of(layout, board)
}

const API = api_of()
const { layout } = API

function fresh(): Grid {
	return API.board.map((row) => row.map((cell): Cell => [cell[0], cell[1]]))
}

// The rows under the area, as text.
function under(grid: Grid): Array<string> {
	return Array.from({ length: layout.h - layout.area_end - 1 }, (_, index) =>
		plain_of(grid, layout.area_end + 1 + index),
	)
}

// The rows under the area once `draw` has drawn on a fresh grid, and whether it drew on the area's
// last row at all (so the part does reach it).
function drawn_under(draw: (grid: Grid) => void): { rows: Array<string>; reaches: boolean } {
	const grid = fresh()

	draw(grid)

	return {
		rows: under(grid),
		reaches: plain_of(grid, layout.area_end) !== plain_of(API.board, layout.area_end),
	}
}

// Every LED position lit with an `8`.
function look(): { ch: string; ink: string; locked: boolean } {
	return { ch: '8', ink: '', locked: true }
}

function expect_cut(draw: (grid: Grid) => void): void {
	const { rows, reaches } = drawn_under(draw)

	expect(reaches).toBe(true)
	expect(rows).toStrictEqual(under(API.board))
}

describe('run_board_theme panel parts on a six-row panel', () => {
	it('lays the short panel out', () => {
		expect(layout.area_end - layout.area_top).toBe(MIN_PANEL_ROWS)
		expect(layout.pw).toBeGreaterThanOrEqual(MIN_PANEL_WIDTH)
	})

	it('cuts WARGAMES’ lamps at the area’s last row, lit and going out', () => {
		const wopr = run_board_theme_wopr_place.wopr_of(API)
		const ending = run_board_theme_wopr_parts.ending_of(wopr)
		const idle = state_of(layout, demo_events(layout.row_text).i, 0)

		expect_cut((grid) => {
			run_board_theme_wopr_idle.paint_lamps(wopr, grid, () => 'hi')
		})
		expect_cut((grid) => {
			ending.draw(grid, LAMPS_OUT_TICK, idle)
		})
	})

	it('cuts WARGAMES’ LED and tic-tac-toe window at the area’s last row', () => {
		const wopr = run_board_theme_wopr_place.wopr_of(API)
		const play = run_board_theme_wopr_panel.game_at(0, () => 1)

		expect_cut((grid) => {
			run_board_theme_wopr_panel.panel(wopr, grid, { status: 'X', status_ink: '', look, play })
		})
	})
})

describe('run_board_theme event screens on a six-row panel', () => {
	it('cuts WARGAMES’ war map at the area’s last row through the NOTICE', () => {
		const wopr = run_board_theme_wopr_place.wopr_of(API)
		const notice = demo_events(layout.row_text).n

		expect_cut((grid) => {
			for (const tick of NOTICE_TICKS) {
				run_board_theme_wopr_map.split(wopr, grid, state_of(layout, notice, tick), tick)
			}
		})
	})

	it('cuts BTTF’s figure at the area’s last row, its time circuits ending there', () => {
		const context = run_board_theme_flux_context.context_of(API)
		const state = state_of(layout, demo_events(layout.row_text).i, 0)
		const moment = { state, motion: run_board_theme_flux_motion.motion_of(state), tick: 0 }

		expect_cut((grid) => {
			run_board_theme_flux_figure.draw_figure(context, grid, moment.motion, 0)
		})
		expect_cut((grid) => {
			run_board_theme_flux_clocks.draw_circuits(context, grid, moment)
		})
	})
})
