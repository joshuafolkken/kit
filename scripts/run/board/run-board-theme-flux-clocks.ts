import type { Face, FluxContext, Moment } from './run-board-theme-flux-context'
import { run_board_theme_flux_data, type Rgb } from './run-board-theme-flux-data'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, Point, ThemeState } from './run-board-theme-host-types'

// The BTTF theme's time circuits (joshuafolkken/kit#8917): the three circuits left of the figure and
// the header's three clocks in their colors, rolling through the JUMP to the next estimate. Ported
// from the confirmed theme demo's `fixed-v21-theme-bttf.mjs`.

const { CIRCUITS, COLON_TICKS, DARK, DIM, WHITE } = run_board_theme_flux_data
const { paint, scaled } = run_board_theme_flux_paint
const { BOLD, put } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { NOTICE_END, active } = run_board_theme_host_state

const ROLL_AT = 12
const ROLL_LEAD = 6
const ROLL_ROW_LAG = 4
const ROLL_PACE = 2
const SPIN_SALT = 40
const DIGIT_SCALE = 10
const DIGIT = /\d/u
const LABEL_LEAD = 3
const LABEL_TRIM = 1
const ROWS_APART = 2
const PHASES = 2
const CIRCUIT_LABELS = ['DESTINATION TIME', 'PRESENT TIME', 'LAST TIME DEPARTED']

// Idle touch: every five seconds one readout, picked afresh, flickers for 6 ticks as if checked.
const CHECK_EVERY = 100
const CHECK_TICKS = 6
const CHECK_SALT = 91

// A clock's character, and whether it still spins.
interface ClockChar {
	ch: string
	is_spinning: boolean
}

// How a clock's characters are painted: the circuit's color, the colon dark, and the ink added.
interface CharLook {
	color: Rgb
	is_dark: boolean
	ink: string
}

function still(text: string): Array<ClockChar> {
	return Array.from(text, (ch) => ({ ch, is_spinning: false }))
}

// The ticks into the jump while the clocks roll, or undefined.
function rolled_t(state: ThemeState, t: number | undefined): number | undefined {
	if (t === undefined || t < ROLL_AT || !active(state.notice, NOTICE_END)) return undefined

	return t
}

// The first `left` digits of `text` spin white; the rest stand still.
function spun(text: string, left: number, seed: { tick: number; y: number }): Array<ClockChar> {
	let place = 0

	return still(text).map((each, index) => {
		if (!DIGIT.test(each.ch)) return each
		place += 1
		if (place - 1 >= left) return each
		const spin = hash(seed.tick, index, SPIN_SALT + seed.y)

		return { ch: String(Math.floor(spin * DIGIT_SCALE)), is_spinning: true }
	})
}

// A clock's characters: those still rolling spin white, stopping left to right, the row below a
// little after the row above (the demo's `roll_clocks`). The rolled destination holds through the
// NOTICE's effect; after it the circuits show the header's three times again, as the header does.
// The time circuits and the big destination read the dated face; the header its own.
function clock_text(face: Face, y: number, roll: number | undefined): string {
	if (y === 0 && roll !== undefined) return face.next

	return face.texts[y] ?? ''
}

function clock_chars(
	context: FluxContext,
	moment: Moment,
	y: number,
	face = context.circuits,
): Array<ClockChar> {
	const roll = rolled_t(moment.state, moment.motion.t)
	const left = roll === undefined ? 0 : (ROLL_AT + ROLL_LEAD + y * ROLL_ROW_LAG - roll) / ROLL_PACE

	return spun(clock_text(face, y, roll), left, { tick: moment.tick, y })
}

function char_color(each: ClockChar, color: Rgb, is_dark: boolean): Rgb {
	if (each.is_spinning) return WHITE

	return is_dark && each.ch === ':' ? scaled(color, DARK) : color
}

// A clock's characters from `at`, each in its color: `ink` is added to each (BOLD, or '').
function put_chars(grid: Grid, at: Point, chars: Array<ClockChar>, look: CharLook): void {
	for (const [index, each] of chars.entries()) {
		const style = paint(char_color(each, look.color, look.is_dark)) + look.ink

		put(grid, { y: at.y, x: at.x + index }, each.ch, style)
	}
}

function checked_of(state: ThemeState, tick: number): number {
	const is_held = active(state.notice, NOTICE_END) || tick % CHECK_EVERY >= CHECK_TICKS
	const pick = hash(Math.floor(tick / CHECK_EVERY), 0, CHECK_SALT)

	if (is_held || tick % PHASES === 0) return -1

	return Math.floor(pick * CIRCUITS.length)
}

function is_dark_at(tick: number): boolean {
	return Math.floor(tick / COLON_TICKS) % PHASES === 1
}

// The panel's left part: each circuit's label dim and its clock lit, the colon dark every other
// half second.
function draw_circuit(context: FluxContext, grid: Grid, moment: Moment, y: number): void {
	const { area_top, px } = context.layout
	const color = CIRCUITS[y] ?? WHITE
	const is_checked = y === checked_of(moment.state, moment.tick)
	const shade = is_checked ? scaled(color, DARK) : color
	const label_at = { y: area_top + 1 + ROWS_APART * y, x: px }
	const look = { color: shade, is_dark: is_dark_at(moment.tick), ink: BOLD }

	put(grid, label_at, CIRCUIT_LABELS[y] ?? '', paint(scaled(color, DIM)))
	put_chars(grid, { y: label_at.y + 1, x: px }, clock_chars(context, moment, y), look)
}

// The panel's left part: each circuit's label dim and its clock lit, the colon dark every other
// half second. Their six rows fit the smallest panel a theme is drawn on (`run-board-theme-layout.ts`).
function draw_circuits(context: FluxContext, grid: Grid, moment: Moment): void {
	for (const y of CIRCUITS.keys()) draw_circuit(context, grid, moment, y)
}

function header_chars(context: FluxContext, moment: Moment, y: number): Array<ClockChar> {
	if (active(moment.state.notice, NOTICE_END)) {
		return clock_chars(context, moment, y, context.header)
	}

	return still(context.header.texts[y] ?? '')
}

function header_clock(context: FluxContext, grid: Grid, moment: Moment, y: number): void {
	const color = CIRCUITS[y] ?? WHITE
	const x = context.clocks[y]?.x ?? -1

	if (x < 0) return
	const lead = context.api.plain(y).slice(x - LABEL_LEAD, x - LABEL_TRIM)
	// The host leaves a painted colon alone, so the clock darkens its own on the host's beat.
	const look = { color, is_dark: is_dark_at(moment.tick), ink: '' }

	put(grid, { y, x: x - LABEL_LEAD }, lead, paint(color))
	put_chars(grid, { y, x }, header_chars(context, moment, y), look)
}

// The header's three clocks in their circuits' colors (the theme's palette); during a NOTICE they
// roll with the rest.
function header_clocks(context: FluxContext, grid: Grid, moment: Moment): void {
	for (const y of CIRCUITS.keys()) header_clock(context, grid, moment, y)
}

const run_board_theme_flux_clocks = {
	ROLL_AT,
	char_color,
	checked_of,
	clock_chars,
	draw_circuits,
	header_clocks,
	is_dark_at,
}

export { run_board_theme_flux_clocks }
export type { ClockChar }
