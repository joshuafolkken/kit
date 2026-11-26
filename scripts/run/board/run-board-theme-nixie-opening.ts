import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Cell, Grid, ThemeApi, ThemeLayout, ThemePart } from './run-board-theme-host-types'
import { run_board_theme_nixie_data, type NixiePart } from './run-board-theme-nixie-data'
import { run_board_theme_nixie_giant } from './run-board-theme-nixie-giant'

// STEINS;GATE's opening (joshuafolkken/kit#8917), ported from the confirmed theme demo: on a dark
// screen the meter's seven tubes warm up one by one in the area — a dim ember flickering, then a lit
// digit spinning — and lock one by one on the idle board's world line, each flashing white as it
// lands; the board then rolls in from the top as digits that settle into its text, the giant meter
// last, and the world line shift lands with one flash and a few tears.

const { BOLD, bg, cell_at, digit, fg, mixed, restyle, set_cell, tear } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { COLOR, FIRST_ALPHA, GIANT, GIANT_X, LOCK_STEP } = run_board_theme_nixie_data
const { giant_digit, giant_point, giant_words } = run_board_theme_nixie_giant

const SG_OPEN = {
	warm: 5,
	lit: 8,
	lock: 40,
	roll: 62,
	area: 92,
	rolling: 6,
	shift: 110,
	done: 118,
	ticks: 130,
}
const SG_VALUE = FIRST_ALPHA
const SG_AMBER = `${fg(COLOR.amber)}${BOLD}`
const HALF = 2
const SALT = { ember: 70, spin: 23, settle: 71, rolling: 72, slip: 73 }
// A tube flashes white for two ticks as it locks; lit, it glows on four ticks in eight.
const WHITE_TICKS = 2
const GLOW_BEAT = { every: 8, lit: 4 }
const BLINK = { every: 4, lit: 2 }
// The area settles over twelve ticks; the rows above and below it over twenty-six from the top,
// each cell up to fourteen ticks late.
const SETTLE = { area: 12, rows: 26, scatter: 14 }
// The shift lands: rows tear for six ticks, fewer each tick, up to four cells either way.
const LANDING = { ticks: 6, odds: 0.3, center: 0.5, reach: 8 }

interface WarmTube {
	x: number
	index: number
	ch: string
}

function warm_glow(tick: number, lock_at: number): string {
	if (tick < lock_at) return COLOR.spin
	if (tick < lock_at + WHITE_TICKS) return COLOR.white

	return tick % GLOW_BEAT.every < GLOW_BEAT.lit ? COLOR.giant_warm : COLOR.amber
}

// Where each tube and the point of the meter sit, and each tube's place among the tubes.
function spots_of(value: string): Array<WarmTube> {
	const spots: Array<WarmTube> = []
	let x = GIANT_X
	let index = 0

	for (const ch of value) {
		const is_tube = ch !== '.'

		spots.push({ x, index, ch })
		x += is_tube ? GIANT.step : GIANT.point_step
		index += Number(is_tube)
	}

	return spots
}

const SPOTS = spots_of(SG_VALUE)
const TUBE_COUNT = SPOTS.filter(({ ch }) => ch !== '.').length

// A tube warming: a dim ember flickering on its eight.
function ember_tube(part: NixiePart, tube: WarmTube, age: number): void {
	const { tick, api } = part
	const share = (hash(tick, tube.index, SALT.ember) * (age + 1)) / SG_OPEN.lit
	const ember = fg(mixed(COLOR.ember_dark, COLOR.ember_lit, share))

	giant_digit(
		part.grid,
		{ y: api.layout.area_top, x: tube.x },
		{ ch: '8', style: ember, ghost: ember },
	)
}

// A tube lit: a digit spinning, then locking white on its own.
function lit_tube(part: NixiePart, tube: WarmTube): void {
	const { tick, api } = part
	const lock_at = SG_OPEN.lock + LOCK_STEP * tube.index
	const shown = tick < lock_at ? digit(hash(tick, tube.index, SALT.spin)) : tube.ch
	const style = `${fg(warm_glow(tick, lock_at))}${BOLD}`

	giant_digit(
		part.grid,
		{ y: api.layout.area_top, x: tube.x },
		{ ch: shown, style, ghost: fg(COLOR.ghost) },
	)
}

function warm_tube(part: NixiePart, tube: WarmTube): void {
	const age = part.tick - SG_OPEN.warm * tube.index

	if (age < 0) return

	if (age < SG_OPEN.lit) {
		ember_tube(part, tube, age)

		return
	}

	lit_tube(part, tube)
}

function warm_point(part: NixiePart, x: number): void {
	if (part.tick < SG_OPEN.warm + SG_OPEN.lit) return
	giant_point(part.grid, part.api.layout.area_end, x, SG_AMBER)
}

function warm_spot(part: NixiePart, spot: WarmTube): void {
	if (spot.ch === '.') warm_point(part, spot.x)
	else warm_tube(part, spot)
}

function warm_words(part: NixiePart): void {
	const { grid, tick, api } = part
	const is_locked = tick >= SG_OPEN.lock + LOCK_STEP * (TUBE_COUNT - 1) + WHITE_TICKS
	const color = is_locked || tick % BLINK.every < BLINK.lit ? COLOR.label : COLOR.amber
	const field = is_locked ? ['α ATTRACTOR', 'FIELD'] : ['WORLD LINE', 'SHIFTING…']

	giant_words(grid, api.layout.area_top, field, `${fg(color)}${BOLD}`)
}

function warm_meter(part: NixiePart): void {
	for (const spot of SPOTS) warm_spot(part, spot)

	if (part.tick >= SG_OPEN.lit) warm_words(part)
}

// When a cell of the board has settled: row by row from the top with a scatter, the area last.
function settle_at(layout: ThemeLayout, x: number, y: number): number {
	if (y >= layout.area_top && y <= layout.area_end) {
		return SG_OPEN.area + Math.floor(hash(x, y, SALT.settle) * SETTLE.area)
	}

	const row_at = Math.floor((y / layout.h) * SETTLE.rows)

	return SG_OPEN.roll + row_at + Math.floor(hash(x, y, SALT.settle) * SETTLE.scatter)
}

// A cell of the board rolling in: none yet, a rolling digit, then its own.
function rolled_cell(part: NixiePart, board: Grid, x: number, y: number): Cell | undefined {
	const { tick, api } = part
	const at = settle_at(api.layout, x, y)

	if (tick < at - SG_OPEN.rolling) return undefined
	const cell = cell_at(board, y, x)

	if (tick >= at || cell[0] === ' ') return cell

	return [digit(hash(x, Math.floor(tick / HALF), y)), `${fg(COLOR.landed)}${BOLD}`]
}

function roll_row(part: NixiePart, board: Grid, y: number): void {
	for (let x = 0; x < part.api.layout.w; x++) {
		const cell = rolled_cell(part, board, x, y)

		if (cell) set_cell(part.grid, { y, x }, cell)
	}
}

// The board rolling in: a cell rolls as a digit for a moment before it settles into its own text.
function roll_in(part: NixiePart, board: Grid): void {
	for (let y = 0; y < part.api.layout.h; y++) roll_row(part, board, y)
}

// The world line shift lands: one flash, and a few rows tear.
function shift_landing(part: NixiePart): void {
	const { grid, tick } = part
	const age = tick - SG_OPEN.shift

	if (age === 0) {
		restyle(
			grid,
			() => true,
			() => `${fg(COLOR.flash_ink)}${bg(COLOR.flash_paper)}`,
		)
	}

	for (let y = 0; y < grid.length; y++) {
		if (hash(tick, y, SALT.rolling) < LANDING.odds * (1 - age / LANDING.ticks)) {
			tear(grid, y, Math.round((hash(tick, y, SALT.slip) - LANDING.center) * LANDING.reach))
		}
	}
}

function opening_draw(part: NixiePart): void {
	const { grid, tick, api } = part

	if (tick >= SG_OPEN.done) return

	if (tick >= SG_OPEN.shift) {
		shift_landing(part)

		return
	}

	const board = grid.map((row) => [...row])

	api.blank_screen(grid)
	warm_meter(part)
	roll_in(part, board)
}

function nixie_opening(api: ThemeApi): ThemePart {
	return {
		ticks: SG_OPEN.ticks,
		note: 'the tubes warm one by one, spin and lock on 0.571024 · the board rolls in as digits that settle into text · a shift lands',
		draw: (grid, tick) => {
			opening_draw({ api, grid, tick })
		},
	}
}

const run_board_theme_nixie_opening = { SG_OPEN, nixie_opening, settle_at, warm_glow }

export { run_board_theme_nixie_opening }
