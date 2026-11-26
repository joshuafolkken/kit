import { run_board_theme_flux_bolts } from './run-board-theme-flux-bolts'
import {
	run_board_theme_flux_context,
	type FluxContext,
	type Moment,
} from './run-board-theme-flux-context'
import { run_board_theme_flux_data, type Rgb } from './run-board-theme-flux-data'
import { run_board_theme_flux_gauge } from './run-board-theme-flux-gauge'
import { run_board_theme_flux_motion, type Motion } from './run-board-theme-flux-motion'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, Point } from './run-board-theme-host-types'

// The BTTF theme's whole-screen touches (joshuafolkken/kit#8917): the rule gauge that mirrors the
// speed on every section rule, the shimmer passing down the board, and idle's residual crackle.
// Ported from the confirmed theme demo's `fixed-v21-theme-bttf.mjs`.

const { bolt_of, draw_bolt } = run_board_theme_flux_bolts
const { GAUGE_LAMPS, is_kept } = run_board_theme_flux_context
const { BANDS, ICE, WHITE, numbers_of } = run_board_theme_flux_data
const { SPRING } = run_board_theme_flux_gauge
const { ROW_FALL, TOP_SPEED } = run_board_theme_flux_motion
const { chance, is_blank, mix, paint, recolor } = run_board_theme_flux_paint
const { cell_at, is_rule, set_cell } = run_board_theme_host_grid
const { NOTICE_END, active } = run_board_theme_host_state

// They play only when nothing has happened for 7.5 s, and never touch the notice or progress text
// or the board's name on row 0.
const QUIET = 150
const NAME_END = 16

// The residual crackle: every 1.75 s one or (two times in five) two small bolts, the BOLTS style,
// one stroke of 3 to 5 cells each, crackle on blank cells for 3 ticks, the last one dimmer.
const CRACKLE_EVERY = 35
const CRACKLE_TICKS = 3
const CRACKLE_SEED = 31_000
const CRACKLE_PAIR = 0.4
const PAIR = 2
const CRACKLE_PICKS = 8
const CRACKLE_TOP = 3
const CRACKLE_MIN = 3
const CRACKLE_SPREAD = 3
const PAIR_SALT = 9
const X_SALT = 2
const Y_SALT = 3
const LENGTH_SALT = 4

// Every section rule is a horizontal lamp gauge: its dashes light from the left to the share of the
// rule the speed is of 88, green, then amber, then red at the far end, in the lamp gauge's own
// colors and proportions (16 green lamps, 6 amber, 1 red of 23). As on the gauge, the red is lit
// only at 88; below it the lit length stops at the red zone. The lit end is one brighter cell. The
// rule's words keep their own style; the unlit rest keeps the rule color.
const RULE_END_LIFT = 0.5
// The rule steps with the panel gauge's own ranges (`range_at`: the speed's five ranges, the NOTICE's
// run-up stages), each a number of lamps lit from the left — the tallest lit column of that range's
// gauge: 13 (green), 17, 21, 22 (amber up to the red), and all 23 with the red only at 88.
const RANGE_LAMPS = numbers_of('13 17 21 22 22')
const HALF = 2

// The charge running through: every 7 s an ice-blue shimmer passes down the board two rows a tick,
// lifting the text of the two rows it is on toward ice white.
const SHIMMER_EVERY = 140
const SHIMMER_ROWS = 2
const SHIMMER_LIFT = 0.4

function is_spared(context: FluxContext, x: number, y: number): boolean {
	return is_kept(context.layout, x, y) || (y === 0 && x < NAME_END)
}

// Within the board's own width, below the header: the first of a few picks on a blank cell.
function crackle_at(
	context: FluxContext,
	grid: Grid,
	born: number,
	index: number,
): Point | undefined {
	const { edge, h } = context.layout
	const picks = Array.from({ length: CRACKLE_PICKS }, (_, k) => ({
		x: Math.floor(chance(born, index * CRACKLE_PICKS + k, X_SALT) * edge),
		y:
			CRACKLE_TOP + Math.floor(chance(born, index * CRACKLE_PICKS + k, Y_SALT) * (h - CRACKLE_TOP)),
	}))

	return picks.find(({ x, y }) => is_blank(cell_at(grid, y, x)))
}

// One crackle bolt: the tick its crackle began on (the dice's), its index, and whether it is the
// crackle's last, dimmer tick.
interface Crackle {
	born: number
	index: number
	is_last: boolean
}

function crackle_bolt(context: FluxContext, grid: Grid, seed: Crackle): void {
	const { born, index } = seed
	const at = crackle_at(context, grid, born, index)

	if (!at) return
	const length = CRACKLE_MIN + Math.floor(chance(born, index, LENGTH_SALT) * CRACKLE_SPREAD)
	const bolt = { ...bolt_of(born, index, seed.is_last, at), length }

	draw_bolt(grid, bolt, (x, y) => is_blank(cell_at(grid, y, x)) && !is_spared(context, x, y))
}

function crackle(context: FluxContext, grid: Grid, tick: number): void {
	const phase = tick % CRACKLE_EVERY

	if (phase >= CRACKLE_TICKS) return
	const born = Math.floor(tick / CRACKLE_EVERY) + CRACKLE_SEED
	const count = chance(born, 0, PAIR_SALT) < CRACKLE_PAIR ? PAIR : 1
	const is_last = phase === CRACKLE_TICKS - 1

	for (let index = 0; index < count; index++) crackle_bolt(context, grid, { born, index, is_last })
}

function lamps_at(motion: Motion, tick: number): number {
	if (motion.speed_at(tick) >= TOP_SPEED) return GAUGE_LAMPS
	const range = Math.min(Math.max(0, motion.range_at(tick)), RANGE_LAMPS.length - 1)

	return RANGE_LAMPS[range] ?? GAUGE_LAMPS
}

function cells_of_lamps(context: FluxContext, lamps: number): number {
	return Math.round((lamps * context.layout.edge) / GAUGE_LAMPS)
}

// A change of stage moves the lit end the panel gauge's way: one tick halfway, then the gauge's own
// spring (`SPRING`, lamps past the new height by ticks since the change: 1, 2, 2, 1, -1, 0), the
// same both ways — past it going up, under it going down — and then it holds still. Below 88 the
// spring never lights the red lamp.
function sprung_lamps(motion: Motion, tick: number, since: number): number {
	const to = lamps_at(motion, tick)
	const from = lamps_at(motion, tick - since - 1)

	if (since === 0) return (from + to) / HALF

	return to + (SPRING[since - 1] ?? 0) * Math.sign(to - from)
}

function rule_lit(context: FluxContext, motion: Motion, tick: number): number {
	const since = Array.from({ length: SPRING.length + 1 }).findIndex(
		(_, ago) => lamps_at(motion, tick - ago) !== lamps_at(motion, tick - ago - 1),
	)

	if (since === -1) return cells_of_lamps(context, lamps_at(motion, tick))
	const top = motion.speed_at(tick) >= TOP_SPEED ? GAUGE_LAMPS : GAUGE_LAMPS - 1
	const lamps = sprung_lamps(motion, tick, since)

	return cells_of_lamps(context, Math.min(top, Math.max(0, lamps)))
}

function rule_band(context: FluxContext, x: number): Rgb {
	if (x < context.green_end) return BANDS.green.color

	return x < context.red_from ? BANDS.amber.color : BANDS.red.color
}

// The lit rule's color at `x`; its lit end one brighter cell.
function rule_color(context: FluxContext, x: number, lit: number): Rgb {
	const color = rule_band(context, x)

	return x === lit - 1 ? mix(color, WHITE, RULE_END_LIFT) : color
}

function rule_row(context: FluxContext, grid: Grid, y: number, lit: number): void {
	for (let x = 0; x < lit; x++) {
		const cell = cell_at(grid, y, x)

		if (is_rule(cell)) set_cell(grid, { y, x }, [cell[0], paint(rule_color(context, x, lit))])
	}
}

function rule_gauge(context: FluxContext, grid: Grid, motion: Motion, tick: number): void {
	const lit = rule_lit(context, motion, tick)

	for (const y of context.rule_rows) rule_row(context, grid, y, lit)
}

function shimmer_cell(context: FluxContext, grid: Grid, at: Point): void {
	const { x, y } = at

	if (is_blank(cell_at(grid, y, x)) || is_spared(context, x, y)) return
	recolor(grid, at, (look) => ({ f: mix(look.f, ICE, SHIMMER_LIFT), b: look.b }))
}

function shimmer(context: FluxContext, grid: Grid, tick: number): void {
	const top = (tick % SHIMMER_EVERY) * SHIMMER_ROWS
	const { edge, h } = context.layout

	for (let y = top; y < Math.min(top + SHIMMER_ROWS, h); y++) {
		for (let x = 0; x < edge; x++) shimmer_cell(context, grid, { x, y })
	}
}

// Drawn under the event's own drawing, so the event wins where both land. The rule gauge mirrors the
// speed, so it runs in every event, the NOTICE included (the area display, wash and thaw cover it).
// The NOTICE stops the shimmer (its bolts, flash and thaw recolor everything), as does ROW (it would
// blur the row's own ice-white bursts); the crackle is idle only (stray bolts would read as the event's).
function under_event_touches(context: FluxContext, grid: Grid, moment: Moment): void {
	const { state, motion, tick } = moment

	rule_gauge(context, grid, motion, tick)
	if (active(state.notice, NOTICE_END) || active(state.row, ROW_FALL)) return
	shimmer(context, grid, tick)
}

function idle_touches(context: FluxContext, grid: Grid, moment: Moment): void {
	const { state, tick } = moment

	if (state.busy || state.since < QUIET) return
	crackle(context, grid, tick)
}

const run_board_theme_flux_idle = {
	crackle,
	idle_touches,
	rule_lit,
	shimmer,
	under_event_touches,
}

export { run_board_theme_flux_idle }
