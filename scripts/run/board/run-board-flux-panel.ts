import { run_board_flux, type FluxFlood } from './run-board-flux'
import { run_board_flux_gauge, type GaugeLook } from './run-board-flux-gauge'
import { run_board_jump, type JumpRun } from './run-board-jump'
import {
	run_board_panel_draw,
	type PanelArea,
	type PanelCell,
	type PanelMoment,
	type PanelPainter,
} from './run-board-panel-draw'
import { run_board_rgb } from './run-board-rgb'

// joshuafolkken/kit#8674: the bttf theme's painter of the animation area at idle — the lamp gauge right
// at the throughput rule's end, the flux capacitor two columns left of it, both over the seven rows under
// the rule, and the speed readout in the rule over the capacitor. The frame's lamp places and the usage
// rule are blanked across the area; where the throughput rows leave too little room, only the lamp
// places are blanked.
// joshuafolkken/kit#8677: through a jump the speed climbs to 88 and the gauge steps up with the cueing
// typing row's letters (joshuafolkken/kit#8731), the capacitor floods; on the arrival the speed brakes from 88.

const { FLUX_WIDTH, flux_cells } = run_board_flux
const { LED_COLUMNS, gauge_cells, range_of } = run_board_flux_gauge
const { PANEL_TICK_MS } = run_board_panel_draw
const { TICK_MS, arrive_speed, climb_of, flood_of, is_orange, jump_speed, stage_of, tick_of } =
	run_board_jump

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
// At 88 the readout is white every other tick.
const TOP_COLOR = run_board_rgb.shade_of(run_board_rgb.parsed('255;255;255'), 'white')
const TOP_BLINK = 2
// The readout sits this far into the capacitor's columns.
const SPEED_OFFSET = 3
const BLANK = ' '

// How the figure moves through a moment: the speed and the gauge's range at each tick, the gauge's look
// and the capacitor's flood.
interface Motion {
	speed_at: (tick: number) => number
	range_at: (tick: number) => number
	gauge?: GaugeLook | undefined
	flux?: FluxFlood | undefined
}

function speed_of(tick: number): number {
	return CRUISE + SWAY * Math.sin(tick / SWAY_TICKS)
}

function cruise_motion(): Motion {
	return { speed_at: speed_of, range_at: (tick) => range_of(speed_of(tick)) }
}

// The ms of panel tick `tick` read `at` its own tick `now`.
function ms_at(at: PanelMoment, now: number, tick: number): number {
	return at.ms + (tick - now) * PANEL_TICK_MS
}

// A jump's motion: the speed up its curve, the gauge on the letters typed, the capacitor's flood.
function jump_motion(run: JumpRun, at: PanelMoment, now: number): Motion {
	function t_at(tick: number): number {
		return tick_of(run, ms_at(at, now, tick))
	}

	function speed_at(tick: number): number {
		return jump_speed(t_at(tick), run.letters, speed_of(tick)) ?? speed_of(tick)
	}

	const flood = flood_of(t_at(now), run.letters)

	return {
		speed_at,
		range_at: (tick) => stage_of(t_at(tick), run.letters) ?? range_of(speed_at(tick)),
		gauge: { climb: climb_of(run.letters), is_flooded: flood !== undefined },
		flux: { flood, is_orange: is_orange(t_at(now), run.letters) },
	}
}

// The arrival's motion: the speed braking from 88 as the board thaws.
function arrive_motion(start_ms: number, at: PanelMoment, now: number): Motion {
	function speed_at(tick: number): number {
		const since = Math.floor((ms_at(at, now, tick) - start_ms) / TICK_MS)

		return arrive_speed(since, speed_of(tick)) ?? speed_of(tick)
	}

	return { speed_at, range_at: (tick) => range_of(speed_at(tick)) }
}

function motion_of(at: PanelMoment, now: number): Motion {
	if (at.jump !== undefined) return jump_motion(at.jump, at, now)
	if (at.arrive_ms !== undefined) return arrive_motion(at.arrive_ms, at, now)

	return cruise_motion()
}

// The readout: the speed to one decimal place, padded a space either side.
function speed_text(tick: number, motion: Motion = cruise_motion()): string {
	return ` ${Math.min(TOP_SPEED, motion.speed_at(tick)).toFixed(1).padStart(SPEED_DIGITS)} `
}

function speed_cell(area: PanelArea, left: number, tick: number, motion: Motion): PanelCell {
	const is_top = motion.speed_at(tick) >= TOP_SPEED && tick % TOP_BLINK === 0

	return {
		row: area.top,
		column: left + SPEED_OFFSET,
		text: speed_text(tick, motion),
		fg: is_top ? TOP_COLOR : SPEED_COLOR,
	}
}

// The first column the figure takes, none where it would reach past the frame's lamp places into the
// throughput rows.
function left_of(area: PanelArea): number | undefined {
	const left = area.end - FIGURE_WIDTH + 1
	const start = Math.min(...area.lamps.map((lamp) => lamp.column))

	return left >= start ? left : undefined
}

// The figure's rows the area holds: all of them under the GitHub row, its top ones where the area ends
// first — the rate limit not read, joshuafolkken/kit#8712.
function rows_shown(area: PanelArea): number {
	return Math.min(FIGURE_ROWS, area.rows - 1)
}

function blanks_of(area: PanelArea, left: number): Array<PanelCell> {
	return Array.from({ length: rows_shown(area) * FIGURE_WIDTH }, (_, index) => ({
		row: area.top + 1 + Math.floor(index / FIGURE_WIDTH),
		column: left + (index % FIGURE_WIDTH),
		text: BLANK,
	}))
}

function figure_cells(area: PanelArea, left: number, at: PanelMoment): Array<PanelCell> {
	const tick = Math.floor(at.ms / PANEL_TICK_MS)
	const motion = motion_of(at, tick)
	const top = area.top + 1
	const gauge = { row: top, column: left + FLUX_WIDTH + GAP }
	const flux = { row: top, column: left }

	const bottom = top + rows_shown(area)
	const figure = [
		...flux_cells(flux, tick, motion.range_at(tick), motion.flux),
		...gauge_cells(gauge, tick, motion.range_at, motion.gauge),
	]

	return [
		...blanks_of(area, left),
		...figure.filter((cell) => cell.row < bottom),
		speed_cell(area, left, tick, motion),
	]
}

// The area's cells at a moment, a tick every `PANEL_TICK_MS`: the frame's lamp places blanked, then the
// figure over them where it fits.
function cells(area: PanelArea, at: PanelMoment): ReadonlyArray<PanelCell> {
	const left = left_of(area)
	const lamps = area.lamps.map((lamp) => ({ row: lamp.row, column: lamp.column, text: BLANK }))

	if (left === undefined) return lamps

	return [...lamps, ...figure_cells(area, left, at)]
}

const FLUX_PAINTER: PanelPainter = { is_idle: true, is_ticking: true, cells }

const run_board_flux_panel = { FIGURE_WIDTH, FLUX_PAINTER, speed_text }

export { run_board_flux_panel }
