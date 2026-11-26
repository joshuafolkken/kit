import { run_board_theme_flux_capacitor } from './run-board-theme-flux-capacitor'
import {
	run_board_theme_flux_context,
	type FluxContext,
	type Moment,
} from './run-board-theme-flux-context'
import { run_board_theme_flux_data } from './run-board-theme-flux-data'
import { run_board_theme_flux_gauge, type FigureCell } from './run-board-theme-flux-gauge'
import { run_board_theme_flux_motion, type Motion } from './run-board-theme-flux-motion'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid } from './run-board-theme-host-types'

// The BTTF theme's figure (joshuafolkken/kit#8917, run-board-flux-panel.ts): the flux capacitor and the
// lamp gauge at the panel's right end, and the speed on the panel's last row during an event. Ported
// from the confirmed theme demo's `fixed-v21-theme-bttf.mjs`.

const { flux_cells } = run_board_theme_flux_capacitor
const { FIGURE_WIDTH, FLUX_WIDTH, GAP } = run_board_theme_flux_context
const { BODY, DIM, GEOMETRY, SPEED_COLOR, WHITE } = run_board_theme_flux_data
const { gauge_cells } = run_board_theme_flux_gauge
const { PROGRESS_FALL, ROW_FALL, TOP_SPEED } = run_board_theme_flux_motion
const { paint, scaled } = run_board_theme_flux_paint
const { BOLD, put, rows_to } = run_board_theme_host_grid
const { NOTICE_END, active } = run_board_theme_host_state

const SPEED_DIGITS = 4
const SPEED_GAP = 6
const BLINK = 2

function put_cells(grid: Grid, cells: Array<FigureCell>): void {
	for (const cell of cells) {
		put(grid, { y: cell.row, x: cell.column }, cell.text, paint(cell.fg ?? BODY, cell.bg))
	}
}

// The figure's seven rows, cut at the area's last row.
function draw_figure(context: FluxContext, grid: Grid, motion: Motion, tick: number): void {
	const { figure } = context
	const area = rows_to(grid, context.layout.area_end)
	const blank = Array.from({ length: GEOMETRY.picture.length }, (_, row) => ({
		row: figure.row + row,
		column: figure.column,
		text: ' '.repeat(FIGURE_WIDTH),
	}))
	const gauge_at = { row: figure.row, column: figure.column + FLUX_WIDTH + GAP }

	put_cells(area, blank)
	put_cells(area, flux_cells(figure, tick, motion.range_at(tick), motion.flux))
	put_cells(area, gauge_cells(gauge_at, tick, motion.range_at, motion.gauge))
}

function speed_line(context: FluxContext, grid: Grid, speed: number, tick: number): void {
	const { area_end, px } = context.layout
	const is_top = speed >= TOP_SPEED && tick % BLINK === 0
	const text = `${Math.min(TOP_SPEED, speed).toFixed(1).padStart(SPEED_DIGITS)} MPH`

	put(grid, { y: area_end, x: px }, 'SPEED', paint(scaled(SPEED_COLOR, DIM)))
	put(grid, { y: area_end, x: px + SPEED_GAP }, text, paint(is_top ? WHITE : SPEED_COLOR) + BOLD)
}

// The speed, during an event only, on the panel's last row under the circuits (the rule keeps the
// frame's own dashes); white every other tick at 88.
function draw_speed(context: FluxContext, grid: Grid, moment: Moment): void {
	const { state, motion, tick } = moment
	const is_event =
		active(state.progress, PROGRESS_FALL) ||
		active(state.row, ROW_FALL) ||
		active(state.notice, NOTICE_END)

	if (!is_event) return
	speed_line(context, grid, motion.speed_at(tick), tick)
}

const run_board_theme_flux_figure = { draw_figure, draw_speed, speed_line }

export { run_board_theme_flux_figure }
