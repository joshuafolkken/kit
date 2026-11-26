import { run_board_theme_flux_data, type Rgb } from './run-board-theme-flux-data'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'
import type { Grid, Point } from './run-board-theme-host-types'

// The BTTF theme's bolts (joshuafolkken/kit#8917, bttf-bolts-theme-demo.mjs): 2 to 5 cells, mostly
// `╲╱` turns, now and then a kink; one or two ticks of life. The JUMP, the typed lines and the idle
// crackle all throw them. Ported from the confirmed theme demo's `fixed-v21-theme-bttf.mjs`.

const { ARC, WHITE } = run_board_theme_flux_data
const { HEAD_BACK, OLD_BACK, chance, look_of, paint, scaled } = run_board_theme_flux_paint

const BOLT_MIN = 2
const BOLT_SPREAD = 4
const ZIG_SHARE = 0.7
const OLD_LIGHT = 0.65
const HALF = 0.5
const LENGTH_SALT = 4
const PARITY_SALT = 6
const SIGN_SALT = 7
const KINK_SALT = 30
const TURN_SALT = 10
const COLOR_SALT = 60
const X_SALT = 2
const Y_SALT = 3
const PARITIES = 2

// One stroke of a bolt: its glyph, and the step to the next cell.
interface Stroke {
	ch: string
	dx: number
	dy: number
}

const BOLT_TURNS: ReadonlyArray<Stroke> = [
	{ ch: '╲', dx: 1, dy: 1 },
	{ ch: '╱', dx: -1, dy: 1 },
]
const BOLT_KINKS: ReadonlyArray<Stroke> = [
	{ ch: '│', dx: 0, dy: 1 },
	{ ch: '─', dx: 1, dy: 0 },
	{ ch: '─', dx: -1, dy: 0 },
	{ ch: '┼', dx: 0, dy: 1 },
	{ ch: '╳', dx: 0, dy: 1 },
]
const [FIRST_TURN = { ch: '╲', dx: 1, dy: 1 }] = BOLT_TURNS
const TINTS: ReadonlyArray<Rgb> = [ARC, ARC, WHITE]

interface Bolt {
	born: number
	index: number
	is_old: boolean
	at: Point
	length: number
	parity: number
	sign: number
}

type Fits = (x: number, y: number) => boolean

// A swarm of bolts alive at `now`: born this tick, or the tick before with a two-tick life. `seed`
// turns a tick into the bolts' dice, `count` gives how many a tick throws, `place` where each starts.
interface Swarm {
	now: number
	count: (born: number) => number
	seed: (born: number) => number
	place: (seed: number, index: number) => Point
	can_draw: Fits
}

function stroke_of(bolt: Bolt, step: number): Stroke {
	const { born, index } = bolt

	if (chance(born, index, TURN_SALT + step) < ZIG_SHARE) {
		return BOLT_TURNS[(step + bolt.parity) % PARITIES] ?? FIRST_TURN
	}

	const kink = Math.floor(chance(born, index, KINK_SALT + step) * BOLT_KINKS.length)

	return BOLT_KINKS[kink] ?? FIRST_TURN
}

function color_of(bolt: Bolt, step: number): Rgb {
	if (bolt.is_old) return scaled(ARC, OLD_LIGHT)
	if (step === 0) return WHITE

	return TINTS[Math.floor(chance(bolt.born, bolt.index, COLOR_SALT + step) * TINTS.length)] ?? ARC
}

function back_of(bolt: Bolt, step: number, style: string): Rgb | undefined {
	if (step !== 0) return look_of(style).b

	return bolt.is_old ? OLD_BACK : HEAD_BACK
}

function bolt_cell(grid: Grid, bolt: Bolt, at: Point, step: number): void {
	const row = grid[at.y]
	const cell = row?.[at.x]

	if (!row || !cell) return
	const { ch } = stroke_of(bolt, step)

	row[at.x] = [ch, paint(color_of(bolt, step), back_of(bolt, step, cell[1]))]
}

// One bolt's cells; `can_draw(x, y)` says where a bolt may draw.
function draw_bolt(grid: Grid, bolt: Bolt, can_draw: Fits): void {
	let { x, y } = bolt.at

	for (let step = 0; step < bolt.length; step++) {
		if (can_draw(x, y)) bolt_cell(grid, bolt, { x, y }, step)
		const { dx, dy } = stroke_of(bolt, step)

		x += dx * bolt.sign
		y += dy
	}
}

function bolt_of(born: number, index: number, is_old: boolean, at: Point): Bolt {
	return {
		born,
		index,
		is_old,
		at,
		length: BOLT_MIN + Math.floor(chance(born, index, LENGTH_SALT) * BOLT_SPREAD),
		parity: chance(born, index, PARITY_SALT) < HALF ? 0 : 1,
		sign: chance(born, index, SIGN_SALT) < HALF ? 1 : -1,
	}
}

// Half the bolts born the tick before have died.
function is_dead(seed: number, index: number, is_old: boolean): boolean {
	return is_old && chance(seed, index, 1) < HALF
}

function swarm_born(grid: Grid, swarm: Swarm, born: number): void {
	const seed = swarm.seed(born)
	const is_old = born < swarm.now

	for (let index = 0; index < swarm.count(born); index++) {
		if (is_dead(seed, index, is_old)) continue
		draw_bolt(grid, bolt_of(seed, index, is_old, swarm.place(seed, index)), swarm.can_draw)
	}
}

function draw_swarm(grid: Grid, swarm: Swarm): void {
	for (const born of [swarm.now - 1, swarm.now]) swarm_born(grid, swarm, born)
}

// A bolt's start anywhere in a `w` by `h` box from `left` and `top`: its dice 2 and 3.
function place_in(box: { left: number; top: number; w: number; h: number }): Swarm['place'] {
	return (seed, index) => ({
		x: box.left + Math.floor(chance(seed, index, X_SALT) * box.w),
		y: box.top + Math.floor(chance(seed, index, Y_SALT) * box.h),
	})
}

const run_board_theme_flux_bolts = {
	BOLT_TURNS,
	bolt_of,
	draw_bolt,
	draw_swarm,
	place_in,
	stroke_of,
}

export { run_board_theme_flux_bolts }
export type { Bolt, Fits, Stroke, Swarm }
