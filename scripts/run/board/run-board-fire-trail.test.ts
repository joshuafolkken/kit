import { describe, expect, it } from 'vitest'
import { run_board_fire_trail } from './run-board-fire-trail'
import type { PaintCell } from './run-board-jump-paint'
import { run_board_rgb, type Rgb } from './run-board-rgb'

// joshuafolkken/kit#8675: the bttf jump's twin fire trails.

const { COLUMNS_PER_TICK, FIRE_TICKS, FLAMES, HEAD_TICKS, fire_of, padded, rows_of, trail_cells } =
	run_board_fire_trail
const { parsed, scaled } = run_board_rgb
const GREY: Rgb = [100, 100, 100]
const WHITE = parsed('255;255;255')
const ROW = 4
const COLUMNS = 130
const FIRE = ['255;255;235', '255;244;165', '205;220;255', '95;135;255', '35;50;150'].map((color) =>
	parsed(color),
)

function half(): number {
	return 0.5
}

function cell_at(x: number, y = ROW): PaintCell {
	return { x, y, text: ' ', fg: GREY, is_figure: false }
}

function row_cells(): Array<PaintCell> {
	return Array.from({ length: COLUMNS }, (_, x) => cell_at(x))
}

function fire(index: number): Rgb {
	return FIRE[index] ?? GREY
}

function burned_at(x: number, t: number): PaintCell {
	return trail_cells([cell_at(x)], t, [ROW], half)[0] ?? cell_at(x)
}

describe('run_board_fire_trail.fire_of', () => {
	it('goes white, pale yellow, blue-white, blue and dark blue, out after 58 ticks', () => {
		expect([0, 4, 22, 34, 47].map((age) => fire_of(age))).toStrictEqual(FIRE)
		expect(fire_of(FIRE_TICKS - 0.1)).toStrictEqual(fire(4))
		expect(fire_of(FIRE_TICKS)).toBeUndefined()
		expect(FIRE_TICKS).toBe(58)
	})
})

describe('run_board_fire_trail.trail_cells — the head', () => {
	it('runs left to right 13 columns a tick, a white block on its fire for its first 1.5 ticks', () => {
		const t = 5
		const head = burned_at(t * COLUMNS_PER_TICK, t)

		expect(COLUMNS_PER_TICK).toBe(13)
		expect(HEAD_TICKS).toBe(1.5)
		expect(head).toStrictEqual({ ...cell_at(65), text: '█', fg: WHITE, bg: scaled(fire(0), 0.9) })
		// 1.46 ticks behind the head is still white-hot; 1.54 is a flame.
		expect(burned_at(46, t).text).toBe('█')
		expect(burned_at(45, t).text).not.toBe('█')
	})

	it('leaves the cells ahead of the head as they are', () => {
		const t = 2

		expect(burned_at(t * COLUMNS_PER_TICK + 1, t)).toStrictEqual(cell_at(27))
		expect(fire_of(-0.1)).toBeUndefined()
	})
})

describe('run_board_fire_trail.trail_cells — the flames', () => {
	it('burns a flame of its own height on a darkening ground of its fire', () => {
		const age = 10
		const flame = burned_at(0, age)
		const left = 1 - age / FIRE_TICKS
		const height = Math.round(left * FLAMES.length * (0.45 + 0.5 * 0.55))

		expect(flame.text).toBe(FLAMES[height - 1])
		expect(flame.fg).toStrictEqual(scaled(fire(1), 0.95))
		expect(flame.bg).toStrictEqual(scaled(fire(1), 0.42 * left))
	})

	it('burns out 58 ticks after the head passes, leaving the cell as it was', () => {
		const x = 26

		expect(burned_at(x, 2 + FIRE_TICKS - 1).fg).toStrictEqual(scaled(fire(4), 0.95))
		expect(burned_at(x, 2 + FIRE_TICKS)).toStrictEqual(cell_at(x))
	})

	it('leaves rows off the trails and the board before the jump as they are', () => {
		const cells = [...row_cells(), cell_at(0, ROW + 1)]
		const burning = trail_cells(cells, 3, [ROW], half)

		expect(burning.at(-1)).toStrictEqual(cell_at(0, ROW + 1))
		expect(trail_cells(cells, -1, [ROW], half)).toStrictEqual(cells)
	})
})

describe('run_board_fire_trail.padded', () => {
	it('fills the trail rows out to the screen width with blank cells, leaving the others', () => {
		const letter = { text: 'a', style: 'S', is_wide: false }
		const screen = {
			rows: [[letter], []],
			columns: 3,
			skips: new Set<string>(),
			typing_rows: new Set<number>(),
		}
		const blank = { text: ' ', style: '', is_wide: false }

		expect(padded(screen, [1]).rows).toStrictEqual([[letter], [blank, blank, blank]])
	})
})

describe('run_board_fire_trail.rows_of', () => {
	it('finds the blank row right above the throughput rule and the lanes rule', () => {
		const texts = [
			'header',
			'',
			'── 📈 throughput ─────',
			'line',
			' '.repeat(3),
			'── -- lanes 1/3 ──',
			'#1 lanes of a lane',
			'',
			'▾ 🧵 lanes ──',
			'',
			'───── lanes ──',
		]

		expect(rows_of(texts)).toStrictEqual([1, 4, 7, 9])
	})

	it('skips a rule with no blank row above it and a row merely naming the lanes', () => {
		expect(rows_of(['── 📈 throughput ──', 'x', '── 🏠 kit ── lanes', ''])).toStrictEqual([])
	})
})
