import { run_board_theme_flux_clocks } from './run-board-theme-flux-clocks'
import type { FluxContext, Moment } from './run-board-theme-flux-context'
import { run_board_theme_flux_data, type Rgb } from './run-board-theme-flux-data'
import { run_board_theme_flux_display } from './run-board-theme-flux-display'
import { run_board_theme_flux_figure } from './run-board-theme-flux-figure'
import { run_board_theme_flux_motion } from './run-board-theme-flux-motion'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'
import { run_board_theme_flux_run } from './run-board-theme-flux-run'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, Point } from './run-board-theme-host-types'

// The BTTF theme's JUMP (joshuafolkken/kit#8917): the run up, then at the peak the screen washes
// blue-white to white, fire trails burn along the two gaps and the board thaws back from ice. Ported
// from the confirmed theme demo's `fixed-v21-theme-bttf.mjs`.

const { ROLL_AT } = run_board_theme_flux_clocks
const { FIRE, FLASH_BACK, ICE, TINTS, WHITE } = run_board_theme_flux_data
const { AREA_UNTIL } = run_board_theme_flux_display
const { draw_figure } = run_board_theme_flux_figure
const { THAW_TICKS, WASH_TICKS } = run_board_theme_flux_motion
const { is_blank, mix, noise, paint, recolor, scaled } = run_board_theme_flux_paint
const { draw_arcs, draw_bolts, lane_of, whiten_lane } = run_board_theme_flux_run
const { cell_at, code_points, set_cell } = run_board_theme_host_grid
const { NOTICE_END, active } = run_board_theme_host_state

const TINT_TICKS = 2
const TINT_SHARE = 0.6
const FLASH_SHARE = 0.9
const WHITE_FROM = 0.8
const WASH_GROUND = 0.4
const FIRE_TICKS = 58
const HEAD_TICKS = 1.5
const FLAMES = code_points('▁▂▃▄▅▆▇█')
const FULL = '█'
// The demo's trail pace; the ENDING's length still counts on it.
const DEMO_TRAIL_COLUMNS_PER_TICK = 13
// The NOTICE's and the ENDING's trails run twice the demo's pace (a kit-only touch over the demo,
// joshuafolkken/kit#8917); both events keep their length and hold the burnt-out picture after.
const TRAIL_COLUMNS_PER_TICK = 26
const FLAME_BASE = 0.45
const FLAME_SEED = 0.55
const FLAME_LIGHT = 0.9
const FLAME_SEED_LIGHT = 0.1
const HEAD_GROUND = 0.9
const FLAME_GROUND = 0.42
const TRAIL_SALT = 300
// Every cell goes from ice white to its own color, each at its own moment, the top rows first; in
// quarter steps, and blank cells left alone, so a frame writes few cells.
const THAW_STEPS = 4
const THAW_SPREAD = 18
const THAW_SPAN = 14
const AREA_THAW = 20

// A wash: the color every cell's letters go most of the way to, and how far.
interface Tint {
	color: Rgb
	share: number
}

// Where a thaw runs: its rows, the columns before `x_end`, and the ticks since it began.
interface Thaw {
	since: number
	rows: Array<number>
	x_end: number
}

// The flash's wash at `t` ticks after the jump: the tints in turn, then the blue-white.
function tint_of(t: number): Tint {
	const tint = TINTS[Math.floor(t / TINT_TICKS)]

	return tint ? { color: tint, share: TINT_SHARE } : { color: FLASH_BACK, share: FLASH_SHARE }
}

// Every cell's letters go most of the way to `color`, on a darker ground of it.
function wash(context: FluxContext, grid: Grid, tint: Tint, rows = context.all_rows): void {
	const { color, share } = tint
	const to = share > WHITE_FROM ? WHITE : color
	const ground = scaled(color, WASH_GROUND)

	for (const y of rows) {
		for (let x = 0; x < context.layout.w; x++) {
			recolor(grid, { y, x }, (look) => ({ f: mix(look.f, to, share), b: look.b ?? ground }))
		}
	}
}

function fire_of(age: number): Rgb | undefined {
	return FIRE.find(({ limit }) => age < limit)?.color
}

// One flame of a trail `age` ticks old: a white-hot head, then a flame leaping to its own height.
function flame_of(age: number, seed: number): Cell | undefined {
	const fire = fire_of(age)

	if (!fire || age < 0) return undefined
	if (age < HEAD_TICKS) return [FULL, paint(WHITE, scaled(fire, HEAD_GROUND))]
	const life = 1 - age / FIRE_TICKS
	const height = Math.max(1, Math.round(life * FLAMES.length * (FLAME_BASE + seed * FLAME_SEED)))
	const color = scaled(fire, FLAME_LIGHT + seed * FLAME_SEED_LIGHT)

	return [FLAMES[height - 1] ?? FULL, paint(color, scaled(fire, FLAME_GROUND * life))]
}

// A trail's burn: the ticks since it lit, the frame's tick, and the columns its head runs a tick.
interface Burn {
	t: number
	tick: number
	pace: number
}

function burn_row(context: FluxContext, grid: Grid, y: number, run: Burn): void {
	for (let x = 0; x < context.layout.w; x++) {
		const seed = noise(run.tick, x, y + TRAIL_SALT)
		const flame = flame_of(run.t - x / run.pace, seed)

		if (flame) set_cell(grid, { y, x }, flame)
	}
}

function burn_trails(context: FluxContext, grid: Grid, run: Burn): void {
	for (const y of context.trail_rows) burn_row(context, grid, y, run)
}

function stepped(share: number): number {
	return Math.round(Math.min(1, Math.max(0, share)) * THAW_STEPS) / THAW_STEPS
}

function thaw_cell(context: FluxContext, grid: Grid, at: Point, since: number): void {
	const { x, y } = at

	if (is_blank(cell_at(grid, y, x))) return
	const share = stepped((since - noise(x, y) * THAW_SPREAD - y * context.row_lag) / THAW_SPAN)

	if (share < 1) recolor(grid, at, (look) => ({ f: mix(ICE, look.f, share), b: look.b }))
}

function thaw(context: FluxContext, grid: Grid, place: Thaw): void {
	if (place.since >= THAW_TICKS) return

	for (const y of place.rows) {
		for (let x = 0; x < place.x_end; x++) thaw_cell(context, grid, { x, y }, place.since)
	}
}

// After the flash: the board thaws back from ice white as on arrival, the trails burn, the clocks
// roll; the wash lies over all of it for the flash's ticks.
function after_jump(context: FluxContext, grid: Grid, t: number, tick: number): void {
	const { all_rows, area_right, area_rows, layout } = context

	if (t >= WASH_TICKS) {
		thaw(context, grid, { since: t - WASH_TICKS, rows: all_rows, x_end: layout.w })
	}

	if (t >= AREA_UNTIL && t < AREA_UNTIL + AREA_THAW) {
		const since = (t - AREA_UNTIL) * (THAW_TICKS / AREA_THAW)

		thaw(context, grid, { since, rows: area_rows, x_end: area_right })
	}

	burn_trails(context, grid, { t, tick, pace: TRAIL_COLUMNS_PER_TICK })
	if (t < ROLL_AT + 1) wash(context, grid, tint_of(t))
}

function run_up(context: FluxContext, grid: Grid, moment: Moment, t: number): void {
	const { state, tick } = moment
	const letters = state.notice.total
	const lane = lane_of(context, state)

	whiten_lane(context, grid, lane, (t + letters) / letters)
	draw_arcs(context, grid, { lane, t, tick })
}

// The ticks from the jump while the NOTICE's effect plays from the start of its run, or undefined.
function jump_t(moment: Moment): number | undefined {
	const { state, motion } = moment
	const { t } = motion

	if (t === undefined || t < -state.notice.total || !active(state.notice, NOTICE_END)) {
		return undefined
	}

	return t
}

function draw_jump(context: FluxContext, grid: Grid, moment: Moment): void {
	const { state, motion, tick } = moment
	const t = jump_t(moment)

	if (t === undefined) return
	if (t < 0) run_up(context, grid, moment, t)
	else after_jump(context, grid, t, tick)
	// Through the flood the capacitor and the lamps keep their own light over the wash.
	if (motion.flux?.flood !== undefined) draw_figure(context, grid, motion, tick)
	draw_bolts(context, grid, t, state.notice.total)
}

const run_board_theme_flux_jump = {
	DEMO_TRAIL_COLUMNS_PER_TICK,
	FIRE_TICKS,
	TRAIL_COLUMNS_PER_TICK,
	burn_trails,
	draw_jump,
	flame_of,
	stepped,
	thaw,
	tint_of,
	wash,
}

export { run_board_theme_flux_jump }
export type { Tint }
