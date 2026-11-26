import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { ThemeState } from './run-board-theme-host-types'
import { run_board_theme_nixie_data, type NixieDraw } from './run-board-theme-nixie-data'

// STEINS;GATE's idle life (joshuafolkken/kit#8917), ported from the confirmed theme demo: a row
// slips now and then; every six seconds a warm current runs along the area's rules toward the
// meter, and the tubes swell as it arrives; between times a digit on the board misreads for a
// moment, as if the world line wavered.

const { BOLD, cell_at, digit, fg, is_rule, set_cell, tear } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { COLOR, IDLE_AFTER } = run_board_theme_nixie_data

const NOISE = { share: 0.04, salt: 77, row_salt: 78, side_salt: 79, side_share: 0.5 }
// The current: a new one every 120 ticks, four cells a tick, a tail of ten; the tubes swell from
// four ticks before it arrives for ten ticks.
const CURRENT = { every: 120, step: 4, tail: 10, swell: 10, early: 4 }
const HEAT = { r: 120, r_gain: 135, g: 55, g_gain: 155, b: 15, b_gain: 105 }
const MISREAD = { beat: 4, share: 0.3, attempts: 8, salt: 90, y_salt: 91, x_salt: 92, top: 3 }
const DIGIT_CHAR = /\d/u

function is_idle(state: ThemeState): boolean {
	return !state.busy && state.since >= IDLE_AFTER
}

// Idle: once in a while one row slips a cell sideways for a single tick.
function idle_noise(frame: NixieDraw): void {
	const { grid, state, tick } = frame

	if (!is_idle(state) || hash(tick, 0, NOISE.salt) >= NOISE.share) return
	const y = Math.floor(hash(tick, 0, NOISE.row_salt) * frame.api.layout.h)

	tear(grid, y, hash(tick, 0, NOISE.side_salt) < NOISE.side_share ? 1 : -1)
}

// Whether the current is arriving at the meter: the tubes swell.
function is_swelling(state: ThemeState, tick: number, edge: number): boolean {
	const age = tick % CURRENT.every
	const arrives = Math.ceil(edge / CURRENT.step)

	return is_idle(state) && age >= arrives - CURRENT.early && age < arrives + CURRENT.swell
}

function heat_color(heat: number): string {
	const red = Math.round(HEAT.r + HEAT.r_gain * heat)
	const green = Math.round(HEAT.g + HEAT.g_gain * heat)
	const blue = Math.round(HEAT.b + HEAT.b_gain * heat)

	return `${String(red)};${String(green)};${String(blue)}`
}

function current_row(frame: NixieDraw, y: number, head: number): void {
	const { grid } = frame
	const last = Math.min(frame.api.layout.edge - 1, head)

	for (let x = Math.max(0, head - CURRENT.tail); x <= last; x++) {
		const cell = cell_at(grid, y, x)

		if (!is_rule(cell)) continue
		const heat = 1 - (head - x) / (CURRENT.tail + 1)

		set_cell(grid, { y, x }, [cell[0], fg(heat_color(heat))])
	}
}

function idle_current(frame: NixieDraw): void {
	const { area_top, area_end } = frame.api.layout

	if (!is_idle(frame.state)) return
	const head = (frame.tick % CURRENT.every) * CURRENT.step

	for (let y = area_top; y <= area_end; y++) current_row(frame, y, head)
}

function misread_at(frame: NixieDraw, beat: number, attempt: number): boolean {
	const { grid, api } = frame
	const y = Math.floor(hash(beat, attempt, MISREAD.y_salt) * api.layout.h)
	const x = Math.floor(hash(beat, attempt, MISREAD.x_salt) * api.layout.edge)

	if (y < MISREAD.top || !DIGIT_CHAR.test(cell_at(grid, y, x)[0])) return false
	set_cell(grid, { y, x }, [digit(hash(beat, x, y)), `${fg(COLOR.misread)}${BOLD}`])

	return true
}

function idle_misread(frame: NixieDraw): void {
	const beat = Math.floor(frame.tick / MISREAD.beat)

	if (!is_idle(frame.state) || hash(beat, 0, MISREAD.salt) >= MISREAD.share) return

	for (let attempt = 0; attempt < MISREAD.attempts; attempt++) {
		if (misread_at(frame, beat, attempt)) return
	}
}

const run_board_theme_nixie_idle = {
	heat_color,
	idle_current,
	idle_misread,
	idle_noise,
	is_idle,
	is_swelling,
}

export { run_board_theme_nixie_idle }
