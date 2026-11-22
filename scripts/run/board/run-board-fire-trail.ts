import type { PaintCell } from './run-board-jump-paint'
import { run_board_rgb, type Rgb } from './run-board-rgb'

// joshuafolkken/kit#8675: the bttf jump's twin fire trails. From the jump on, the blank row above the
// throughput rule and the one above the lanes rule burn left to right, `COLUMNS_PER_TICK` columns a
// tick: a cell is a white-hot `█` for its first `HEAD_TICKS`, then a flame of its own height leaping
// every tick, glowing on a ground of its fire, pale yellow while it burns and going out through blue.

const { parsed, scaled } = run_board_rgb

const WHITE = parsed('255;255;255')
// The fire's colors, hottest first, and how many ticks old a cell is at most to take each; out after
// the last.
const FIRE_COLORS = ['255;255;235', '255;244;165', '205;220;255', '95;135;255', '35;50;150'].map(
	(color) => parsed(color),
)
const FIRE_LIMITS = '4 22 34 47 58'.split(' ').map(Number)
const FIRE_TICKS = FIRE_LIMITS.at(-1) ?? 0
const HEAD_TICKS = 1.5
const HEAD = '█'
// A flame's heights, low to high.
const FLAMES = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const COLUMNS_PER_TICK = 13
// The ticks a trail burns after the jump at most: its fire, and its crossing of up to 260 columns.
const CROSS_TICKS = 20
const TRAIL_TICKS = FIRE_TICKS + CROSS_TICKS
// A flame's height is this share of its full one at least, up to all of it by its roll.
const HEIGHT_FLOOR = 0.45
// Its letters glow this share of its fire at least, up to all of it by its roll.
const GLOW_FLOOR = 0.9
// Its ground: the head's, and a flame's as it starts, darkening as it burns down.
const HEAD_GROUND = 0.9
const FLAME_GROUND = 0.42
// Each tick moves the rolls this far.
const TICK_SHIFT = 17.3
// A section rule's lead, and the sections whose rules have a trail above: named first after the lead,
// or after its icon.
const LEAD = /^[▸▾─]+/u
const NAMED = new Set(['throughput', 'lanes'])
const NAME_WORDS = 2

// A stable roll in 0..1 for a place, so a flame's height leaps by the tick but not by the redraw.
type Roll = (x: number, y: number) => number

// The fire of a cell `age` ticks old; none before the front reaches it or after it burns out.
function fire_of(age: number): Rgb | undefined {
	if (age < 0) return undefined

	return FIRE_COLORS[FIRE_LIMITS.findIndex((limit) => age < limit)]
}

// Whether a row is the throughput rule or the lanes rule.
function is_rule(text: string): boolean {
	if (!LEAD.test(text)) return false
	const words = text.replace(LEAD, '').trim().split(/\s+/u).slice(0, NAME_WORDS)

	return words.some((word) => NAMED.has(word))
}

// The blank rows right above the throughput rule and the lanes rule, 0-based.
function rows_of(texts: ReadonlyArray<string>): Array<number> {
	return texts
		.map((_, y) => y - 1)
		.filter((above) => is_rule(texts[above + 1] ?? '') && texts[above]?.trim() === '')
}

// A flame `age` ticks old in `fire`, its height and its glow by the two rolls.
function flame_of(cell: PaintCell, age: number, fire: Rgb, rolls: [number, number]): PaintCell {
	const left = 1 - age / FIRE_TICKS
	const [height_roll, glow_roll] = rolls
	const share = HEIGHT_FLOOR + height_roll * (1 - HEIGHT_FLOOR)
	const height = Math.max(1, Math.round(left * FLAMES.length * share))
	const fg = scaled(fire, GLOW_FLOOR + glow_roll * (1 - GLOW_FLOOR))

	return { ...cell, text: FLAMES[height - 1] ?? HEAD, fg, bg: scaled(fire, FLAME_GROUND * left) }
}

// A trail row's cell `t` ticks from the jump: the head, a flame, or as it is once burned out.
function burned(cell: PaintCell, t: number, roll: Roll): PaintCell {
	const age = t - cell.x / COLUMNS_PER_TICK
	const fire = fire_of(age)

	if (fire === undefined) return cell
	if (age < HEAD_TICKS) return { ...cell, text: HEAD, fg: WHITE, bg: scaled(fire, HEAD_GROUND) }
	const shift = t * TICK_SHIFT

	return flame_of(cell, age, fire, [roll(cell.x + shift, cell.y), roll(cell.y, cell.x + shift)])
}

// The board `t` ticks from the jump with the trails burning on `rows`; as it is before the jump.
function trail_cells(
	cells: ReadonlyArray<PaintCell>,
	t: number,
	rows: ReadonlyArray<number>,
	roll: Roll,
): Array<PaintCell> {
	if (t < 0) return [...cells]

	return cells.map((cell) => (rows.includes(cell.y) ? burned(cell, t, roll) : cell))
}

const run_board_fire_trail = {
	COLUMNS_PER_TICK,
	FIRE_TICKS,
	FLAMES,
	HEAD_TICKS,
	TRAIL_TICKS,
	fire_of,
	rows_of,
	trail_cells,
}

export { run_board_fire_trail }
