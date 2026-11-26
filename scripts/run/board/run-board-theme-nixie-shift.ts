import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Cell } from './run-board-theme-host-types'
import {
	run_board_theme_nixie_data,
	type NixieDraw,
	type Shift,
} from './run-board-theme-nixie-data'

// STEINS;GATE after an event lands (joshuafolkken/kit#8917), ported from the confirmed theme demo: a
// band of digits ripples across the screen, and the world line shift tears rows and sprays digits,
// fading out, as hard as the event that caused it.

const { BOLD, bg, digit, fg, pick, restyle, tear } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { COLOR, SHIFTS, SPRAY, SPRAY_GLYPHS } = run_board_theme_nixie_data

// The ripple: eight cells a tick, five wide, for eighteen ticks.
const RIPPLE = { ticks: 18, speed: 8, width: 5, salt: 9 }
const TEARS = { cap: 0.9, odds: 0.45, salt: 11, shift_salt: 12, reach: 10, center: 0.5 }
const SPRAYING = { share: 0.07, salt: 50 }

function is_rippling(frame: NixieDraw): boolean {
	const { state } = frame

	return (
		!state.busy &&
		state.since < RIPPLE.ticks &&
		state.latest !== undefined &&
		state.latest !== 'notice'
	)
}

function in_band(x: number, at: number): boolean {
	return x >= at && x < at + RIPPLE.width
}

// After a ROW the band comes from the right edge too.
function in_back_band(frame: NixieDraw, x: number, at: number): boolean {
	const from = frame.api.layout.edge - at

	return frame.state.latest === 'row' && x <= from && x > from - RIPPLE.width
}

function is_rippled(frame: NixieDraw, ch: string, x: number, at: number): boolean {
	return ch !== ' ' && (in_band(x, at) || in_back_band(frame, x, at))
}

function ripple_row(row: Array<Cell>, at: number): void {
	for (const [x, [ch, style]] of row.entries()) {
		if (ch !== ' ' && in_band(x, at)) row[x] = [digit(hash(x, at, RIPPLE.salt)), style]
	}
}

// After a PROGRESS or a ROW: a band of digits crosses the whole screen, from both sides after a ROW.
function ripple(frame: NixieDraw): void {
	if (!is_rippling(frame)) return
	const { grid } = frame
	const at = frame.state.since * RIPPLE.speed

	restyle(
		grid,
		([ch], x) => is_rippled(frame, ch, x, at),
		() => `${fg(COLOR.spark)}${BOLD}`,
	)

	for (const row of grid) ripple_row(row, at)
}

function is_flash_tick(shift: Shift, since: number): boolean {
	return since < shift.flashes * shift.flash_every && since % shift.flash_every === 0
}

function shift_tears(frame: NixieDraw, shift: Shift, power: number): void {
	const { grid, tick } = frame
	const reach = TEARS.reach * Math.max(1, shift.power)

	for (let y = 0; y < grid.length; y++) {
		if (hash(tick, y, TEARS.salt) < Math.min(TEARS.cap, TEARS.odds * power)) {
			tear(grid, y, Math.round((hash(tick, y, TEARS.shift_salt) - TEARS.center) * reach))
		}
	}
}

function is_sprayed(tick: number, x: number, y: number, power: number): boolean {
	return hash(tick, x, y + SPRAYING.salt) < SPRAYING.share * power
}

function spray_row(row: Array<Cell>, y: number, tick: number, power: number): void {
	for (const [x, cell] of row.entries()) {
		if (is_sprayed(tick, x, y, power)) row[x] = [pick(SPRAY_GLYPHS, hash(y, x, tick)), cell[1]]
	}
}

function spray(frame: NixieDraw, power: number): void {
	const { grid, tick } = frame

	restyle(
		grid,
		(_, x, y) => is_sprayed(tick, x, y, power),
		(x, y) => `${fg(pick(SPRAY, hash(x, y, tick)))}${BOLD}`,
	)

	for (const [y, row] of grid.entries()) spray_row(row, y, tick, power)
}

function shift_of(frame: NixieDraw): Shift | undefined {
	const { state } = frame
	const shift = state.latest === undefined ? undefined : SHIFTS[state.latest]

	if (!shift || state.busy || state.since >= shift.ticks) return undefined

	return shift
}

// A world line shift: rows tear sideways and digits spray, fading out; how hard depends on the event.
function world_line_shift(frame: NixieDraw): void {
	const shift = shift_of(frame)

	if (!shift) return
	const { since } = frame.state
	const power = shift.power * (1 - since / shift.ticks)

	if (is_flash_tick(shift, since)) {
		restyle(
			frame.grid,
			() => true,
			() => `${fg(COLOR.flash_ink)}${bg(COLOR.flash_paper)}`,
		)
	}

	shift_tears(frame, shift, power)
	spray(frame, power)
}

const run_board_theme_nixie_shift = { is_flash_tick, ripple, world_line_shift }

export { run_board_theme_nixie_shift }
