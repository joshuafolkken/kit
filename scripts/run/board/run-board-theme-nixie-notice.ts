import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Channel, ThemeLayout } from './run-board-theme-host-types'
import { run_board_theme_nixie_data, type NixieDraw } from './run-board-theme-nixie-data'

// STEINS;GATE's NOTICE, a D-mail (joshuafolkken/kit#8917), ported from the confirmed theme demo: the
// board dissolves into digits as it types and discharges cross the area; afterward the board
// settles back into its text cell by cell while aftershocks tear rows and bands of digits cross.

const { BOLD, digit, fg, put, tear } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { trace_on } = run_board_theme_host_flash
const { NOTICE_END, TRACE_END, TRACE_EVERY, TRACE_ON } = run_board_theme_host_state
const { COLOR } = run_board_theme_nixie_data

const HALF = 2
const DISSOLVE = { curve: 1.5, share: 0.6, salt: 500, tear_odds: 0.2 }
// The discharges: three while the notice types, on two ticks in three; after the peak two with the
// trace's first bar and one with each later bar, on every other tick.
const BOLTS = { typing: 3, first_bar: 2, later: 1, beat: 3, rest: 2 }
const BOLT = { y_salt: 40, step_salt: 41, white_salt: 42, white_share: 0.3, up: 0.25, down: 0.75 }
// The afterglow settles back over a hundred ticks.
const SETTLE_TICKS = 100
const SETTLE = { open: 0.75, salt: 600 }
const AFTERSHOCK_ODDS = 0.1
const BAND = { width: 6, salt: 15 }

interface Line {
	row: Array<Cell>
	y: number
}

// A row slipping: the noise that picks it, the noise that moves it, and how far either way.
interface Slip {
	salt: number
	shift_salt: number
	reach: number
}

const DISSOLVE_SLIP: Slip = { salt: 501, shift_salt: 502, reach: 6 }
const AFTERSHOCK_SLIP: Slip = { salt: 13, shift_salt: 14, reach: 8 }
const SLIP_CENTER = 0.5

// Row `y` slips sideways when its noise falls under `odds`.
function slip_row(frame: NixieDraw, y: number, odds: number, slip: Slip): void {
	const { grid, tick } = frame

	if (hash(tick, y, slip.salt) >= odds) return
	tear(grid, y, Math.round((hash(tick, y, slip.shift_salt) - SLIP_CENTER) * slip.reach))
}

function dissolve_row(frame: NixieDraw, line: Line, depth: number): void {
	const half_tick = Math.floor(frame.tick / HALF)
	const { row, y } = line

	for (const [x, [ch, style]] of row.entries()) {
		if (ch !== ' ' && hash(half_tick, x, y + DISSOLVE.salt) < DISSOLVE.share * depth) {
			row[x] = [digit(hash(x, half_tick, y)), style]
		}
	}
}

// A notice arriving: the board dissolves into digits and its rows start to slip, more as it types.
function dissolve(frame: NixieDraw): void {
	const { grid, state, api } = frame
	const { notice } = state

	if (!notice.is_typing) return
	const depth = (notice.length / notice.total) ** DISSOLVE.curve

	for (const [y, row] of grid.entries()) {
		if (y === api.layout.notice.y) continue
		dissolve_row(frame, { row, y }, depth)
		slip_row(frame, y, DISSOLVE.tear_odds * depth, DISSOLVE_SLIP)
	}
}

// After the peak the discharges go on in the afterglow, on every other tick.
function is_discharging(frame: NixieDraw): boolean {
	const { state, tick } = frame
	const is_echo = trace_on(state) && tick % HALF === 0

	return is_echo || (state.notice.is_typing && tick % BOLTS.beat !== BOLTS.rest)
}

function bolts_of(notice: Channel): number {
	if (notice.is_typing) return BOLTS.typing

	return notice.cooled < TRACE_ON ? BOLTS.first_bar : BOLTS.later
}

function next_y(layout: ThemeLayout, y: number, step: number): number {
	if (step < BOLT.up) return Math.max(layout.area_top, y - 1)
	if (step > BOLT.down) return Math.min(layout.area_end, y + 1)

	return y
}

function bolt_char(next: number, y: number): string {
	if (next < y) return '╱'

	return next > y ? '╲' : '─'
}

function draw_bolt(frame: NixieDraw, bolt: number): void {
	const { grid, tick, api } = frame
	const { area_top, area_end, edge } = api.layout
	let y = area_top + Math.floor(hash(tick, bolt, BOLT.y_salt) * (area_end - area_top + 1))

	for (let x = 0; x < edge; x++) {
		const next = next_y(api.layout, y, hash(tick, x, BOLT.step_salt + bolt))
		const color = hash(tick, x, BOLT.white_salt) < BOLT.white_share ? COLOR.white : COLOR.bolt

		put(grid, { y: next, x }, bolt_char(next, y), `${fg(color)}${BOLD}`)
		y = next
	}
}

// A notice arriving: three blue-white discharges jump across the whole area.
function discharge(frame: NixieDraw): void {
	if (!is_discharging(frame)) return
	const bolts = bolts_of(frame.state.notice)

	for (let bolt = 0; bolt < bolts; bolt++) draw_bolt(frame, bolt)
}

function is_afterglow(notice: Channel, ticks: number): boolean {
	return notice.index >= 0 && !notice.is_typing && notice.cooled < ticks
}

// The notice's row and the area keep their own text.
function is_kept_row(layout: ThemeLayout, y: number): boolean {
	return y === layout.notice.y || (y >= layout.area_top && y <= layout.area_end)
}

function resettle_row(frame: NixieDraw, line: Line, open: number): void {
	const half_tick = Math.floor(frame.tick / HALF)
	const { row, y } = line

	for (const [x, [ch]] of row.entries()) {
		if (ch !== ' ' && hash(x, y, SETTLE.salt) < open) {
			row[x] = [digit(hash(x, half_tick, y)), fg(COLOR.settling)]
		}
	}
}

// The afterglow of a NOTICE, first part: the shift leaves the board as digits, and cell by cell it
// settles back into its own text, each cell at its own moment, the unsettled ones dim and rolling.
function resettle(frame: NixieDraw): void {
	const { grid, state, api } = frame

	if (!is_afterglow(state.notice, SETTLE_TICKS)) return
	const open = SETTLE.open * (1 - state.notice.cooled / SETTLE_TICKS)

	for (const [y, row] of grid.entries()) {
		if (!is_kept_row(api.layout, y)) resettle_row(frame, { row, y }, open)
	}
}

function band_row(row: Array<Cell>, at: number): void {
	for (const [x, [ch]] of row.entries()) {
		if (ch !== ' ' && x >= at && x < at + BAND.width) {
			row[x] = [digit(hash(x, at, BAND.salt)), `${fg(COLOR.spark)}${BOLD}`]
		}
	}
}

// With each bar of the notice's trace a band of bright digits crosses the whole screen.
function trace_band(frame: NixieDraw): void {
	const { cooled } = frame.state.notice
	const since_bar = cooled % TRACE_EVERY

	if (cooled >= TRACE_END || since_bar >= TRACE_ON) return
	const at = since_bar * Math.ceil(frame.api.layout.w / TRACE_ON)

	for (const row of frame.grid) band_row(row, at)
}

function is_aftershock(notice: Channel): boolean {
	return is_afterglow(notice, NOTICE_END)
}

// The afterglow, second part: aftershocks. Until the NOTICE ends a row still tears now and then,
// less and less often, and with each bar of the notice's trace a band of bright digits crosses the
// whole screen.
function aftershocks(frame: NixieDraw): void {
	const { grid, state } = frame

	if (!is_aftershock(state.notice)) return
	const power = 1 - state.notice.cooled / NOTICE_END

	for (let y = 0; y < grid.length; y++) slip_row(frame, y, AFTERSHOCK_ODDS * power, AFTERSHOCK_SLIP)

	trace_band(frame)
}

const run_board_theme_nixie_notice = {
	aftershocks,
	bolt_char,
	discharge,
	dissolve,
	is_aftershock,
	next_y,
	resettle,
}

export { run_board_theme_nixie_notice }
