import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Cell, ThemeApi, ThemePart } from './run-board-theme-host-types'
import { run_board_theme_nixie_data, type NixiePart } from './run-board-theme-nixie-data'
import { run_board_theme_nixie_meter } from './run-board-theme-nixie-meter'

// STEINS;GATE's ending (joshuafolkken/kit#8917), ported from the confirmed theme demo: a world line
// shift takes the board away. The screen flashes twice, rows tear, the board breaks up into digits
// and the digits go out; the meter spins over the emptying screen, locks on a β world line, and its
// tubes cool to dark one by one; then a second of empty screen.

const { big_digit } = run_board_theme_host_fonts
const { BOLD, bg, code_points, digit, fg, mixed, put, put_level, restyle, tear } =
	run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { BLINK, COLOR, FIRST_BETA, LOCK_STEP } = run_board_theme_nixie_data
const { METER, METER_W } = run_board_theme_nixie_meter

const SG_END = { dissolve: 36, lock: 56, cool: 70, cool_ticks: 6, dark: 98, ticks: 118 }
const SG_TO = FIRST_BETA
const SG_AMBER = `${fg(COLOR.amber)}${BOLD}`
const HALF = 2
// A cell breaks up into a digit at its own moment and goes out ten to twenty-one ticks later; one in
// five rolls bright, the rest sit dim.
const BREAK = {
	from_salt: 81,
	gone_salt: 82,
	still_salt: 83,
	bright_salt: 84,
	last: 10,
	scatter: 12,
}
const BRIGHT_SHARE = 0.2
// Rows tear for the first fifty ticks, fewer each tick, up to five cells either way.
const TEARS = { ticks: 50, odds: 0.18, salt: 85, shift_salt: 86, center: 0.5, reach: 10 }
// The ending's two flashes.
const FLASHES = { first: 0, second: 3 }
// The tubes lock two ticks apart, then flash white for two ticks.
const LOCK_GAP = 2
const WHITE_TICKS = 2
const SPIN_SALT = 21

// One tube's look: its character, its glow and its unlit segments' color.
interface TubeLook {
	ch: string
	glow: string
	ghost: string
}

function rolled_cell(tick: number, x: number, y: number): Cell {
	if (hash(x, y, BREAK.bright_salt) < BRIGHT_SHARE) {
		return [digit(hash(x, Math.floor(tick / HALF), y)), `${fg(COLOR.dust)}${BOLD}`]
	}

	return [digit(hash(x, y, BREAK.still_salt)), fg(COLOR.settling)]
}

// A cell of the board as it breaks up: itself, a digit, then gone.
function ended_cell(tick: number, x: number, y: number, ch: string): Cell | undefined {
	const from = Math.floor(hash(x, y, BREAK.from_salt) * SG_END.dissolve)

	if (tick < from) return undefined
	const gone = from + BREAK.last + Math.floor(hash(x, y, BREAK.gone_salt) * BREAK.scatter)

	if (ch === ' ' || tick >= gone) return [' ', 'body']

	return rolled_cell(tick, x, y)
}

function ending_tears(part: NixiePart): void {
	const { grid, tick } = part

	if (tick >= TEARS.ticks) return

	for (let y = 0; y < grid.length; y++) {
		if (hash(tick, y, TEARS.salt) < TEARS.odds * (1 - tick / TEARS.ticks)) {
			tear(grid, y, Math.round((hash(tick, y, TEARS.shift_salt) - TEARS.center) * TEARS.reach))
		}
	}
}

function dissolve_row(row: Array<Cell>, y: number, tick: number): void {
	for (const [x, [ch]] of row.entries()) {
		const cell = ended_cell(tick, x, y, ch)

		if (cell) row[x] = cell
	}
}

function dissolve_board(part: NixiePart): void {
	for (const [y, row] of part.grid.entries()) dissolve_row(row, y, part.tick)

	ending_tears(part)
}

// One tube spinning, then locking white.
function locking_look(tick: number, index: number, ch: string): TubeLook | undefined {
	const lock_at = SG_END.lock + LOCK_GAP * index

	if (ch !== '.' && tick < lock_at) {
		return { ch: digit(hash(tick, index, SPIN_SALT)), glow: COLOR.spin, ghost: COLOR.ghost }
	}

	return tick < lock_at + WHITE_TICKS ? { ch, glow: COLOR.white, ghost: COLOR.ghost } : undefined
}

// One tube lit, then cooling to dark; none once it has.
function cooled_look(tick: number, index: number, ch: string): TubeLook | undefined {
	const share = (tick - SG_END.cool - LOCK_STEP * index) / SG_END.cool_ticks

	if (share >= 1) return undefined
	if (share <= 0) return { ch, glow: COLOR.amber, ghost: COLOR.ghost }

	return {
		ch,
		glow: mixed(COLOR.amber, COLOR.ghost, share),
		ghost: mixed(COLOR.ghost, COLOR.cold, share),
	}
}

// One tube of the meter at the board's own place: spinning, locking white, lit, then cooling.
function cooling_look(tick: number, index: number): TubeLook | undefined {
	const ch = SG_TO.charAt(index)

	return locking_look(tick, index, ch) ?? cooled_look(tick, index, ch)
}

function cooling_label(part: NixiePart): void {
	const { grid, tick, api } = part
	const is_locked = tick >= SG_END.lock + LOCK_GAP * SG_TO.length
	const words = is_locked ? 'β ATTRACTOR FIELD' : 'WORLD LINE SHIFTING…'
	const style =
		!is_locked && tick % BLINK.every < BLINK.lit ? `${fg(COLOR.label)}${BOLD}` : SG_AMBER

	if (tick < SG_END.cool) put_level(grid, api.layout.level_spot, ` ${words}`, style)
}

function cooling_tube(part: NixiePart, index: number, x: number): void {
	const look = cooling_look(part.tick, index)

	if (!look) return
	big_digit(part.grid, { y: part.api.layout.area_top + METER.y, x }, look.ch, {
		style: `${fg(look.glow)}${BOLD}`,
		ghost: fg(look.ghost),
	})
}

function cooling_meter(part: NixiePart): void {
	const { grid, api } = part
	let x = api.layout.edge - METER_W

	for (let row = 0; row < METER.rows; row++) {
		put(grid, { y: api.layout.area_top + METER.y + row, x: x - 1 }, ' '.repeat(METER_W + 1), 'body')
	}

	for (const [index, ch] of code_points(SG_TO).entries()) {
		cooling_tube(part, index, x)
		x += ch === '.' ? METER.point_step : METER.tube_step
	}

	cooling_label(part)
}

function ending_draw(part: NixiePart): void {
	const { grid, tick, api } = part

	if (tick >= SG_END.dark) {
		api.blank_screen(grid)

		return
	}

	dissolve_board(part)
	cooling_meter(part)

	if (tick === FLASHES.first || tick === FLASHES.second) {
		restyle(
			grid,
			() => true,
			() => `${fg(COLOR.flash_ink)}${bg(COLOR.flash_paper)}`,
		)
	}
}

function nixie_ending(api: ThemeApi): ThemePart {
	return {
		ticks: SG_END.ticks,
		note: 'a world line shift: flashes, rows tear, the board dissolves into digits · the meter locks on β and its tubes cool one by one',
		draw: (grid, tick) => {
			ending_draw({ api, grid, tick })
		},
	}
}

const run_board_theme_nixie_ending = { SG_END, cooling_look, ended_cell, nixie_ending }

export { run_board_theme_nixie_ending }
