import { run_board_rgb, type Rgb } from './run-board-rgb'

// joshuafolkken/kit#8740: the bttf run up's small lightning bolts over the whole screen. Each is 2 to 5
// cells, mostly a `╲╱` zig-zag, now and then a `│─┼╳` kink; it lives one or two ticks, its shape keyed
// by the tick it was born and its number so a second tick draws it again. More are born as the run up
// climbs, most in the flood: about 40 show the tick before the jump. As the demo's BOLTS draws them.

const { parsed, scaled } = run_board_rgb

const WHITE = parsed('255;255;255')
const ARC = parsed('150;210;255')
// A bolt's ground at its head, and its colors in its second tick.
const HEAD_GROUND = 0.35
const OLD_GROUND = 0.15
const OLD_LIGHT = 0.65
const HEAD_BACK = scaled(ARC, HEAD_GROUND)
const OLD_BACK = scaled(ARC, OLD_GROUND)
const OLD_FG = scaled(ARC, OLD_LIGHT)
// The bolts born a tick at the peak; the share of it reached before the flood, the rest in it.
const BOLT_SPAWN = 27
const RAMP_SHARE = 0.4
const FLOOD_TICKS = 15
const BOLT_MIN = 2
const BOLT_SPREAD = 4
const ZIG_SHARE = 0.7
const HALF = 0.5
// About a third of a fresh bolt's body cells are white, the rest arc.
const BODY_WHITE = 0.333
// What each draw of a bolt is keyed by, as the demo's `chance` salts.
const SALT = { old: 1, x: 2, y: 3, length: 4, parity: 6, sign: 7, turn: 10, body: 20, kink: 30 }
const SPREAD = { born: 1.618, salt_x: 7.31, index: 3.77, salt_y: 0.53 }

// One step of a bolt: its letter and where the next cell is, `dx` mirrored by the bolt's sign.
interface BoltStep {
	text: string
	dx: number
	dy: number
}

const DOWN_RIGHT: BoltStep = { text: '╲', dx: 1, dy: 1 }
const DOWN: BoltStep = { text: '│', dx: 0, dy: 1 }
const BOLT_TURNS: ReadonlyArray<BoltStep> = [DOWN_RIGHT, { text: '╱', dx: -1, dy: 1 }]
const BOLT_KINKS: ReadonlyArray<BoltStep> = [
	DOWN,
	{ text: '─', dx: 1, dy: 0 },
	{ text: '─', dx: -1, dy: 0 },
	{ text: '┼', dx: 0, dy: 1 },
	{ text: '╳', dx: 0, dy: 1 },
]

type Noise = (x: number, y: number) => number
type Roll = (salt: number) => number

// A bolt's cell: its letter and colors; no `bg` keeps the cell's own ground.
interface BoltCell {
	text: string
	fg: Rgb
	bg?: Rgb | undefined
}

// A bolt's cell where it lands, 0-based.
interface BoltSpot extends BoltCell {
	x: number
	y: number
}

// The screen the bolts land on and the run up's length in ticks (its notice's letters).
interface BoltArea {
	columns: number
	rows: number
	letters: number
}

// A bolt alive at a tick: the tick it was born, its number among them, whether this is its second tick.
interface BoltLife {
	born: number
	index: number
	is_old: boolean
}

// The bolts born `t` ticks from the jump over a run up of `letters` ticks: none outside the run up.
function bolts_born(t: number, letters: number): number {
	if (t < -letters || t >= 0) return 0
	const ramp = Math.min(1, (t + letters) / Math.max(1, letters - FLOOD_TICKS)) * RAMP_SHARE
	const flood = Math.max(0, (t + FLOOD_TICKS) / FLOOD_TICKS) * (1 - RAMP_SHARE)

	return Math.round(BOLT_SPAWN * (ramp + flood))
}

// A stable number in 0..1 for one draw of a bolt, by its salt.
function roller(life: BoltLife, noise: Noise): Roll {
	return (salt) =>
		noise(
			life.born * SPREAD.born + salt * SPREAD.salt_x,
			life.index * SPREAD.index + salt * SPREAD.salt_y,
		)
}

// The bolts alive `t` ticks from the jump: born this tick, or the tick before when it lives two.
function bolts_of(t: number, letters: number, noise: Noise): Array<BoltLife> {
	return [t - 1, t].flatMap((born) =>
		Array.from({ length: bolts_born(born, letters) }, (_, index) => ({
			born,
			index,
			is_old: born < t,
		})).filter((life) => !life.is_old || roller(life, noise)(SALT.old) >= HALF),
	)
}

// Step `step` of a bolt: the zig-zag's turn, alternating from `parity`, or now and then a kink.
function step_of(roll: Roll, step: number, parity: number): BoltStep {
	if (roll(SALT.turn + step) < ZIG_SHARE) {
		return BOLT_TURNS[(step + parity) % BOLT_TURNS.length] ?? DOWN_RIGHT
	}

	return BOLT_KINKS[Math.floor(roll(SALT.kink + step) * BOLT_KINKS.length)] ?? DOWN
}

// A bolt cell's colors in its second tick: all of it dimmer, the head on a dimmer ground.
function old_look(is_head: boolean): Omit<BoltCell, 'text'> {
	return { fg: OLD_FG, bg: is_head ? OLD_BACK : undefined }
}

// A bolt cell's colors: the head white on a dim arc ground, the body arc and now and then white.
function look_of(life: BoltLife, step: number, roll: Roll): Omit<BoltCell, 'text'> {
	const is_head = step === 0

	if (life.is_old) return old_look(is_head)
	if (is_head) return { fg: WHITE, bg: HEAD_BACK }

	return { fg: roll(SALT.body + step) < BODY_WHITE ? WHITE : ARC }
}

// A bolt's cells in step order, off the screen too.
function stroke_of(life: BoltLife, area: BoltArea, noise: Noise): Array<BoltSpot> {
	const roll = roller(life, noise)
	const length = BOLT_MIN + Math.floor(roll(SALT.length) * BOLT_SPREAD)
	const parity = roll(SALT.parity) < HALF ? 0 : 1
	const sign = roll(SALT.sign) < HALF ? 1 : -1
	const at = { x: Math.floor(roll(SALT.x) * area.columns), y: Math.floor(roll(SALT.y) * area.rows) }

	return Array.from({ length }, (_, step) => {
		const { text, dx, dy } = step_of(roll, step, parity)
		const spot = { ...at, text, ...look_of(life, step, roll) }

		Object.assign(at, { x: at.x + dx * sign, y: at.y + dy })

		return spot
	})
}

function is_within(place: number, size: number): boolean {
	return place >= 0 && place < size
}

function is_on(spot: BoltSpot, area: BoltArea): boolean {
	return is_within(spot.x, area.columns) && is_within(spot.y, area.rows)
}

// Every bolt cell on the screen `t` ticks from the jump, by `x;y`, a later bolt over an earlier one.
function bolt_cells(t: number, area: BoltArea, noise: Noise): Map<string, BoltCell> {
	const spots = bolts_of(t, area.letters, noise).flatMap((life) => stroke_of(life, area, noise))

	return new Map(
		spots
			.filter((spot) => is_on(spot, area))
			.map(({ x, y, ...cell }) => [`${String(x)};${String(y)}`, cell]),
	)
}

const run_board_jump_bolts = {
	ARC,
	HEAD_BACK,
	OLD_BACK,
	OLD_FG,
	WHITE,
	bolt_cells,
	bolts_born,
	bolts_of,
	stroke_of,
}

export { run_board_jump_bolts }
export type { BoltArea, BoltCell, BoltLife, BoltSpot }
