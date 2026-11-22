import { run_board_flux } from './run-board-flux'
import { run_board_flux_gauge } from './run-board-flux-gauge'
import {
	run_board_panel_draw,
	type PanelArea,
	type PanelCell,
	type PanelMoment,
	type PanelPainter,
} from './run-board-panel-draw'
import { run_board_rgb } from './run-board-rgb'

// joshuafolkken/kit#8674: the bttf theme's painter of the animation area at idle — the lamp gauge right
// at the throughput rule's end, the flux capacitor two columns left of it, both over the six rows under
// the rule, and the speed readout in the rule over the capacitor. The frame's lamp places and the usage
// rule are blanked across the area; where the throughput rows leave too little room, only the lamp
// places are blanked.

const { FLUX_WIDTH, flux_cells } = run_board_flux
const { LED_COLUMNS, gauge_cells, range_of } = run_board_flux_gauge

const GAP = 2
const FIGURE_WIDTH = FLUX_WIDTH + GAP + LED_COLUMNS
const FIGURE_ROWS = run_board_panel_draw.AREA_ROWS - 1
// The idle speed, a dummy tied to nothing on the board: a cruise swaying a little either side.
const CRUISE = 28
const SWAY = 5
const SWAY_TICKS = 9
const TOP_SPEED = 88
const SPEED_DIGITS = 4
const SPEED_COLOR = run_board_rgb.shade_of(run_board_rgb.parsed('255;175;60'), 'yellow')
// The readout sits this far into the capacitor's columns.
const SPEED_OFFSET = 3
const BLANK = ' '

function speed_of(tick: number): number {
	return CRUISE + SWAY * Math.sin(tick / SWAY_TICKS)
}

function range_at(tick: number): number {
	return range_of(speed_of(tick))
}

// The readout: the speed to one decimal place, padded a space either side.
function speed_text(tick: number): string {
	return ` ${Math.min(TOP_SPEED, speed_of(tick)).toFixed(1).padStart(SPEED_DIGITS)} `
}

// The first column the figure takes, none where it would reach past the frame's lamp places into the
// throughput rows.
function left_of(area: PanelArea): number | undefined {
	const left = area.end - FIGURE_WIDTH + 1
	const start = Math.min(...area.lamps.map((lamp) => lamp.column))

	return left >= start ? left : undefined
}

function blanks_of(area: PanelArea, left: number): Array<PanelCell> {
	return Array.from({ length: FIGURE_ROWS * FIGURE_WIDTH }, (_, index) => ({
		row: area.top + 1 + Math.floor(index / FIGURE_WIDTH),
		column: left + (index % FIGURE_WIDTH),
		text: BLANK,
	}))
}

function figure_cells(area: PanelArea, left: number, tick: number): Array<PanelCell> {
	const top = area.top + 1
	const gauge = { row: top, column: left + FLUX_WIDTH + GAP }
	const speed = {
		row: area.top,
		column: left + SPEED_OFFSET,
		text: speed_text(tick),
		fg: SPEED_COLOR,
	}

	return [
		...blanks_of(area, left),
		...flux_cells({ row: top, column: left }, tick, range_at(tick)),
		...gauge_cells(gauge, tick, range_at),
		speed,
	]
}

// The area's cells at a moment, a tick every `PANEL_TICK_MS`: the frame's lamp places blanked, then the
// figure over them where it fits.
function cells(area: PanelArea, at: PanelMoment): ReadonlyArray<PanelCell> {
	const tick = Math.floor(at.ms / run_board_panel_draw.PANEL_TICK_MS)
	const left = left_of(area)
	const lamps = area.lamps.map((lamp) => ({ row: lamp.row, column: lamp.column, text: BLANK }))

	if (left === undefined) return lamps

	return [...lamps, ...figure_cells(area, left, tick)]
}

const FLUX_PAINTER: PanelPainter = { is_idle: true, is_ticking: true, cells }

const run_board_flux_panel = { FIGURE_WIDTH, FLUX_PAINTER, speed_text }

export { run_board_flux_panel }
