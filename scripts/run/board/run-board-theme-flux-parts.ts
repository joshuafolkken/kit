import type { FluxContext } from './run-board-theme-flux-context'
import { run_board_theme_flux_data } from './run-board-theme-flux-data'
import { run_board_theme_flux_figure } from './run-board-theme-flux-figure'
import { run_board_theme_flux_gauge } from './run-board-theme-flux-gauge'
import { run_board_theme_flux_jump } from './run-board-theme-flux-jump'
import {
	run_board_theme_flux_motion,
	type Motion,
	type MotionState,
} from './run-board-theme-flux-motion'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'
import { run_board_theme_flux_run } from './run-board-theme-flux-run'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemePart } from './run-board-theme-host-types'

// The BTTF theme's opening and ending (joshuafolkken/kit#8917): the keypad line, then the board's
// arrival; and the departure, built from the JUMP's own parts. Ported from the confirmed theme demo's
// `fixed-v21-theme-bttf.mjs`.

const { BODY, WHITE } = run_board_theme_flux_data
const { draw_figure, speed_line } = run_board_theme_flux_figure
const { range_of } = run_board_theme_flux_gauge
const {
	DEMO_TRAIL_COLUMNS_PER_TICK,
	FIRE_TICKS,
	TRAIL_COLUMNS_PER_TICK,
	burn_trails,
	thaw,
	tint_of,
	wash,
} = run_board_theme_flux_jump
const { THAW_TICKS, TOP_SPEED, WASH_TICKS, cruise_of, motion_of } = run_board_theme_flux_motion
const { paint, scaled } = run_board_theme_flux_paint
const { draw_arcs, draw_bolts } = run_board_theme_flux_run
const { put } = run_board_theme_host_grid
const { channel } = run_board_theme_host_state

// Main's bttf intro (`run-board-theme-defs.ts` → `run_board_sound_keypad.LINE`, a letter a tick,
// then a forty-tick hold), typed at the top left of an empty screen as `run-board-intro.ts` does; then
// the arrival (`run-board-jump.ts` ARRIVE_FLASHES, THAW_AT, ARRIVE_THAW_TICKS; `run-board-jump-paint.ts`
// `arrive_cells`): the board black, lit by three flashes each whiter than the last, then thawing from
// ice white while the speed brakes from 88.
const INTRO_LINE = "Roads? Where we're going, we don't need roads."
const INTRO_HOLD = 40
const ARRIVE_AT = INTRO_LINE.length + INTRO_HOLD
const FLASH_ONE = 0.35
const FLASH_TWO = 0.65
const ARRIVE_FLASHES = [
	{ start: 4, ticks: 2, level: FLASH_ONE },
	{ start: 10, ticks: 2, level: FLASH_TWO },
	{ start: 16, ticks: 3, level: 1 },
]
const THAW_AT = 19
const ARRIVE_THAW = 20
const ARRIVE_TICKS = THAW_AT + ARRIVE_THAW
const CURSOR = '█'

// No demo or main code has a bttf exit, so this is built from the JUMP's own parts: a short run up
// (speed to 88, the capacitor flooding, arcs and bolts), the flash, then the board gone and the twin
// fire trails burning out on the empty screen; a second of empty screen to end.
const DEPART_RUN = 30
const EMPTY_HOLD = 20

function blank_all(context: FluxContext, grid: Grid): void {
	for (let y = 0; y < grid.length; y++) context.api.blank_row(grid, y)
}

function intro_line(context: FluxContext, grid: Grid, tick: number): void {
	const shown = INTRO_LINE.slice(0, tick + 1)

	blank_all(context, grid)
	put(grid, { y: 0, x: 0 }, shown === INTRO_LINE ? shown : `${shown}${CURSOR}`, paint(BODY))
}

// The flashes: every letter of the board white at the flash's level, black between flashes.
function arrive_flash(context: FluxContext, grid: Grid, at: number): void {
	const flash = ARRIVE_FLASHES.find(({ start, ticks }) => at >= start && at < start + ticks)

	if (!flash) {
		blank_all(context, grid)

		return
	}

	const style = paint(scaled(WHITE, flash.level))

	for (const row of grid) {
		for (const [x, cell] of row.entries()) row[x] = [cell[0], style]
	}
}

// 88 until the thaw, braking to the cruise through it (`arrive_speed`); `tick` is the opening's own.
function arrive_speed(tick: number): number {
	const share = Math.min(1, Math.max(0, (tick - ARRIVE_AT - THAW_AT) / ARRIVE_THAW))

	return TOP_SPEED + (cruise_of(tick) - TOP_SPEED) * share
}

function arrive_motion(): Motion {
	return {
		t: undefined,
		speed_at: arrive_speed,
		range_at: (tick) => range_of(arrive_speed(tick)),
		gauge: {},
		flux: undefined,
	}
}

function arrive(context: FluxContext, grid: Grid, tick: number): void {
	const motion = arrive_motion()
	const since = (tick - ARRIVE_AT - THAW_AT) * (THAW_TICKS / ARRIVE_THAW)

	draw_figure(context, grid, motion, tick)
	speed_line(context, grid, motion.speed_at(tick), tick)
	thaw(context, grid, { since, rows: context.all_rows, x_end: context.layout.w })
}

function opening_of(context: FluxContext): ThemePart {
	return {
		ticks: ARRIVE_AT + ARRIVE_TICKS,
		note: 'the time-circuit keypad line types on an empty screen, holds, then the board arrives: three flashes, a thaw from ice, 88 braking',
		draw(grid, tick) {
			if (tick < ARRIVE_AT) intro_line(context, grid, tick)
			else if (tick - ARRIVE_AT < THAW_AT) arrive_flash(context, grid, tick - ARRIVE_AT)
			else arrive(context, grid, tick)
		},
	}
}

// The departure as the JUMP's state: a notice of DEPART_RUN ticks from tick 0, nothing else typed.
function departure_of(context: FluxContext, tick: number): MotionState {
	const { notice, progress, row } = context.layout
	const leaving = [{ start: 0, text: '', ticks: DEPART_RUN }]

	return {
		tick,
		notice: channel('notice', leaving, { span: notice, tick }),
		progress: channel('progress', [], { span: progress, tick }),
		row: channel('row', [], { span: row, tick }),
	}
}

function depart_run(context: FluxContext, grid: Grid, motion: Motion, tick: number): void {
	const t = motion.t ?? 0

	draw_figure(context, grid, motion, tick)
	speed_line(context, grid, motion.speed_at(tick), tick)
	draw_arcs(context, grid, { lane: undefined, t, tick })
	draw_bolts(context, grid, t, DEPART_RUN)
}

function depart(context: FluxContext, grid: Grid, tick: number): void {
	const motion = motion_of(departure_of(context, tick))
	const t = motion.t ?? 0

	if (t < 0) {
		depart_run(context, grid, motion, tick)

		return
	}

	if (t >= WASH_TICKS) blank_all(context, grid)
	burn_trails(context, grid, { t, tick, pace: TRAIL_COLUMNS_PER_TICK })
	if (t >= WASH_TICKS) return
	wash(context, grid, tint_of(t))
	draw_figure(context, grid, motion, tick)
}

function ending_of(context: FluxContext): ThemePart {
	const trails_out = FIRE_TICKS + Math.ceil(context.layout.w / DEMO_TRAIL_COLUMNS_PER_TICK)

	return {
		ticks: DEPART_RUN + trails_out + EMPTY_HOLD,
		note: 'new: the departure — speed to 88, bolts and arcs, the flash, the board gone, twin fire trails burn out, a second of empty screen',
		draw(grid, tick) {
			depart(context, grid, tick)
		},
	}
}

const run_board_theme_flux_parts = { ARRIVE_AT, DEPART_RUN, ending_of, opening_of }

export { run_board_theme_flux_parts }
