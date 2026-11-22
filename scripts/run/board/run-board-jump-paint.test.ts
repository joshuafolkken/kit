import { describe, expect, it } from 'vitest'
import { run_board_flux } from './run-board-flux'
import { run_board_jump } from './run-board-jump'
import { run_board_jump_paint, type PaintCell } from './run-board-jump-paint'
import { run_board_rgb, type Rgb } from './run-board-rgb'

// joshuafolkken/kit#8677: the bttf jump and arrival painted over the board cell by cell.

const { ICE, TINTS, arrive_cells, jump_cells, noise } = run_board_jump_paint
const { ARRIVE_TICKS, THAW_AT, WASH_TICKS } = run_board_jump
const { contrast, mixed, parsed, scaled } = run_board_rgb
const GREY: Rgb = [100, 100, 100]
const WHITE = parsed('255;255;255')
const LETTERS = 40
const SCENE = { rows: 20, lane: 5, panel: { top: 18, rows: 1 } }
const COLUMNS = 80
const HEADER_ROWS = 3
const MIN_CONTRAST = 4.5

function cell_at(x: number, y: number, extra: Partial<PaintCell> = {}): PaintCell {
	return { x, y, text: 'a', fg: GREY, is_figure: false, ...extra }
}

function grid(rows: number): Array<PaintCell> {
	return Array.from({ length: rows * COLUMNS }, (_, index) =>
		cell_at(index % COLUMNS, Math.floor(index / COLUMNS)),
	)
}

function changed(
	before: ReadonlyArray<PaintCell>,
	after: ReadonlyArray<PaintCell>,
): Array<PaintCell> {
	return after.filter((cell, index) => JSON.stringify(cell) !== JSON.stringify(before[index]))
}

describe('run_board_jump_paint.jump_cells — outside the jump and the run up', () => {
	it('leaves the board as it is before the first letter and once the thaw is over', () => {
		const cells = grid(2)

		expect(jump_cells(cells, -LETTERS - 1, LETTERS, SCENE)).toStrictEqual(cells)
		expect(jump_cells(cells, WASH_TICKS + 45, LETTERS, SCENE)).toStrictEqual(cells)
	})

	it('leaves the board as it is through the run up where the area is not out', () => {
		const cells = grid(4)

		expect(jump_cells(cells, -1, LETTERS, { rows: 4, lane: 2 })).toStrictEqual(cells)
	})
})

describe('run_board_jump_paint.jump_cells — the run up', () => {
	it('whitens the merging lane row with the letters typed, leaving other rows', () => {
		const lane = cell_at(30, SCENE.lane)
		const other = cell_at(30, SCENE.lane + 1)
		const [lit, kept] = jump_cells([lane, other], -20, LETTERS, SCENE)

		expect(lit?.fg).toStrictEqual(mixed(GREY, WHITE, 0.35))
		expect(kept).toStrictEqual(other)
	})

	it('crosses a flare over the board, its core at its center on the slant', () => {
		const center = cell_at(10, 10)
		const far = cell_at(40, 10)
		const [core, kept] = jump_cells([center, far], -12, LETTERS, SCENE)

		expect(core?.fg).toStrictEqual(parsed('240;248;255'))
		expect(kept).toStrictEqual(far)
	})

	it('crackles arcs over the header rows in its last ticks, leaving the figure and other rows', () => {
		const cells = [...grid(10), cell_at(0, 0, { is_figure: true })]
		const moved = changed(cells, jump_cells(cells, -1, LETTERS, SCENE))

		expect(moved.length).toBeGreaterThan(0)
		expect(moved.every((cell) => cell.y < HEADER_ROWS || cell.y === SCENE.lane)).toBe(true)
		expect(moved.some((cell) => cell.is_figure)).toBe(false)
	})
})

describe('run_board_jump_paint.jump_cells — the wash and the thaw', () => {
	it('washes each cell towards the first tint on a dark ground of it, the figure kept', () => {
		const figure = cell_at(1, 0, { is_figure: true })
		const [washed, kept] = jump_cells([cell_at(0, 0), figure], 0, LETTERS, SCENE)

		expect(washed?.fg).toStrictEqual(mixed(GREY, TINTS[0] ?? GREY, 0.6))
		expect(washed?.bg).toStrictEqual(scaled(TINTS[0] ?? GREY, 0.4))
		expect(kept).toStrictEqual(figure)
	})

	it('turns the letters white once the tints are over, keeping a cell its own ground', () => {
		const ground: Rgb = [10, 20, 30]
		const [washed] = jump_cells([cell_at(0, 0, { bg: ground })], 10, LETTERS, SCENE)

		expect(washed?.fg).toStrictEqual(mixed(GREY, WHITE, 0.9))
		expect(washed?.bg).toStrictEqual(ground)
	})

	it('thaws every cell from ice, the figure too, back to its own color', () => {
		const cells = [cell_at(0, 0), cell_at(5, 9, { is_figure: true })]

		expect(jump_cells(cells, WASH_TICKS, LETTERS, SCENE).map((cell) => cell.fg)).toStrictEqual([
			ICE,
			ICE,
		])
		expect(jump_cells(cells, WASH_TICKS + 44, LETTERS, SCENE)).toStrictEqual(cells)
	})
})

describe('run_board_jump_paint.jump_cells — the fire trails', () => {
	const TRAIL_ROW = 7
	const TRAILS = { ...SCENE, trails: [TRAIL_ROW] }

	it('burns the trail rows under the wash, the head white-hot on its own ground', () => {
		const painted = jump_cells([cell_at(0, TRAIL_ROW), cell_at(0, 0)], 0, LETTERS, TRAILS)
		const fg = mixed(WHITE, TINTS[0] ?? GREY, 0.6)

		expect(painted[0]).toMatchObject({ text: '█', fg, bg: scaled(parsed('255;255;235'), 0.9) })
		expect(painted[1]).toMatchObject({ text: 'a' })
	})

	it('burns over the thaw rather than thawing from ice', () => {
		const cells = [cell_at(0, TRAIL_ROW), cell_at(0, 0)]
		const [flame, thawing] = jump_cells(cells, WASH_TICKS, LETTERS, TRAILS)

		expect(flame?.fg).not.toStrictEqual(ICE)
		expect(flame?.text).not.toBe('a')
		expect(thawing?.fg).toStrictEqual(ICE)
	})

	it('burns on once the thaw is over until the trail burns out', () => {
		const trail = [cell_at(0, TRAIL_ROW)]

		expect(jump_cells(trail, 57, LETTERS, TRAILS)[0]?.text).not.toBe('a')
		expect(jump_cells(trail, 58, LETTERS, TRAILS)).toStrictEqual(trail)
	})
})

describe('run_board_jump_paint.arrive_cells', () => {
	it('is black, then lit by each flash, then thaws from ice, and leaves the board once over', () => {
		const cells = [cell_at(0, 0)]

		expect(arrive_cells(cells, 0)[0]?.fg).toStrictEqual([0, 0, 0])
		expect(arrive_cells(cells, 4)[0]?.fg).toStrictEqual(scaled(WHITE, 0.35))
		expect(arrive_cells(cells, 16)[0]?.fg).toStrictEqual(WHITE)
		expect(arrive_cells(cells, THAW_AT)[0]?.fg).toStrictEqual(ICE)
		expect(arrive_cells(cells, ARRIVE_TICKS)).toStrictEqual(cells)
	})
})

describe('run_board_jump_paint.noise', () => {
	it('is stable for a cell and within 0..1', () => {
		const values = Array.from({ length: 50 }, (_, index) => noise(index, index * 3))

		expect(noise(7, 3)).toBe(noise(7, 3))
		expect(values.every((value) => value >= 0 && value < 1)).toBe(true)
	})
})

describe('run_board_flux.FLOOD — the flooded capacitor', () => {
	it('keeps its white ● readable on the flood and on its dimmed ground', () => {
		expect(contrast(WHITE, run_board_flux.FLOOD)).toBeGreaterThanOrEqual(MIN_CONTRAST)
		expect(contrast(WHITE, run_board_flux.FLOOD_DIM)).toBeGreaterThanOrEqual(MIN_CONTRAST)
	})
})
