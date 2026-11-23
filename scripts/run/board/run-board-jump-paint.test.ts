import { describe, expect, it } from 'vitest'
import { run_board_flux } from './run-board-flux'
import { run_board_jump } from './run-board-jump'
import { run_board_jump_bolts, type BoltCell } from './run-board-jump-bolts'
import { run_board_jump_paint, type JumpScene, type PaintCell } from './run-board-jump-paint'
import { run_board_rgb, type Rgb } from './run-board-rgb'

// joshuafolkken/kit#8677: the bttf jump and arrival painted over the board cell by cell.

const { ICE, TINTS, arrive_cells, jump_cells, noise } = run_board_jump_paint
const { bolt_cells } = run_board_jump_bolts
const { ARRIVE_TICKS, THAW_AT, WASH_TICKS } = run_board_jump
const { contrast, mixed, parsed, scaled } = run_board_rgb
const GREY: Rgb = [100, 100, 100]
const WHITE = parsed('255;255;255')
const LETTERS = 40
const SCENE = { rows: 20, panel: { top: 18, rows: 1 } }
const COLUMNS = 80
const HEADER_ROWS = 3
const MIN_CONTRAST = 4.5
const ARC_MARKS = new Set('╱ ╲ │ ─ ┼'.split(' '))
const SPARK_MARKS = new Set('· *'.split(' '))
const BOLT_MARKS = new Set('╲ ╱ │ ─ ┼ ╳'.split(' '))

function cell_at(x: number, y: number, extra: Partial<PaintCell> = {}): PaintCell {
	return { x, y, text: 'a', fg: GREY, is_figure: false, ...extra }
}

function grid(rows: number): Array<PaintCell> {
	return Array.from({ length: rows * COLUMNS }, (_, index) =>
		cell_at(index % COLUMNS, Math.floor(index / COLUMNS)),
	)
}

function is_white(cell: PaintCell): boolean {
	return cell.fg.join(',') === WHITE.join(',')
}

function changed(
	before: ReadonlyArray<PaintCell>,
	after: ReadonlyArray<PaintCell>,
): Array<PaintCell> {
	return after.filter((cell, index) => JSON.stringify(cell) !== JSON.stringify(before[index]))
}

function bolts_over(
	cells: ReadonlyArray<PaintCell>,
	t: number,
	rows: number,
): Map<string, BoltCell> {
	const columns = Math.max(1, ...cells.map((cell) => cell.x + 1))

	return bolt_cells(t, { columns, rows, letters: LETTERS }, noise)
}

function key_of(cell: PaintCell): string {
	return `${String(cell.x)};${String(cell.y)}`
}

// The cells the run up changes `t` ticks from the jump that no bolt crosses.
function changed_off_bolts(
	cells: ReadonlyArray<PaintCell>,
	t: number,
	scene: JumpScene,
): Array<PaintCell> {
	const bolts = bolts_over(cells, t, scene.rows)

	return changed(cells, jump_cells(cells, t, LETTERS, scene)).filter(
		(cell) => !bolts.has(key_of(cell)),
	)
}

describe('run_board_jump_paint.jump_cells — outside the jump and the run up', () => {
	it('leaves the board as it is before the first letter and once the thaw is over', () => {
		const cells = grid(2)

		expect(jump_cells(cells, -LETTERS - 1, LETTERS, SCENE)).toStrictEqual(cells)
		expect(jump_cells(cells, WASH_TICKS + 45, LETTERS, SCENE)).toStrictEqual(cells)
	})

	// joshuafolkken/kit#8739: the run up crackles with the area out or not.
	it('crackles arcs in the last ticks of the run up where the area is not out', () => {
		const cells = [...grid(4), ...grid(1).map((cell) => ({ ...cell, y: 3, text: ' ' }))]
		const moved = changed_off_bolts(cells, -1, { rows: 4 })

		expect(moved.some((cell) => ARC_MARKS.has(cell.text))).toBe(true)
	})
})

// joshuafolkken/kit#8740: small bolts over the whole screen replace the sparks. A board of letters,
// a blank row and blank line ends.
const BLANK_ROW = 12
const BOLT_BOARD = grid(SCENE.rows).map((cell) =>
	cell.y === BLANK_ROW || cell.x >= COLUMNS / 2 ? { ...cell, text: ' ' } : cell,
)

describe('run_board_jump_paint.jump_cells — the bolts', () => {
	const cells = BOLT_BOARD

	it('ac-14ef7de4 lands no `·*` spark at any tick of the run up', () => {
		const ticks = Array.from({ length: LETTERS }, (_, index) => index - LETTERS)
		const painted = ticks.flatMap((t) => jump_cells(cells, t, LETTERS, SCENE))

		expect(painted.some((cell) => SPARK_MARKS.has(cell.text))).toBe(false)
	})

	it('ac-698b7f71 draws each bolt over letters, blank rows and line ends alike', () => {
		const bolts = bolts_over(cells, -1, SCENE.rows)
		const under = cells.filter((cell) => bolts.has(key_of(cell)))
		const painted = jump_cells(cells, -1, LETTERS, SCENE).filter((cell) => bolts.has(key_of(cell)))

		expect(under.some((cell) => cell.text === 'a')).toBe(true)
		expect(under.some((cell) => cell.y === BLANK_ROW)).toBe(true)
		expect(under.some((cell) => cell.x >= COLUMNS / 2 && cell.y !== BLANK_ROW)).toBe(true)
		expect(painted.map((cell) => cell.text)).toStrictEqual(
			painted.map((cell) => bolts.get(key_of(cell))?.text),
		)
	})
})

describe('run_board_jump_paint.jump_cells — the bolts over the glow and after the jump', () => {
	it('ac-7023dc19 draws the bolts after the glow, over the figure, keeping a ground where none is given', () => {
		const ground: Rgb = [10, 20, 30]
		const figure = grid(SCENE.rows).map((cell) => ({ ...cell, is_figure: true, bg: ground }))
		const bolts = bolts_over(figure, -1, SCENE.rows)
		const painted = jump_cells(figure, -1, LETTERS, SCENE).filter((cell) => bolts.has(key_of(cell)))

		expect(painted).toHaveLength(bolts.size)
		expect(painted.every((cell) => cell.bg === (bolts.get(key_of(cell))?.bg ?? ground))).toBe(true)
		expect(painted.every((cell) => cell.fg === bolts.get(key_of(cell))?.fg)).toBe(true)
	})

	it('ac-7023dc19 draws no bolt from the jump on, through the flash', () => {
		const ticks = Array.from({ length: WASH_TICKS }, (_, index) => index)

		expect(
			ticks.every((t) =>
				jump_cells(BOLT_BOARD, t, LETTERS, SCENE).every((cell) => !BOLT_MARKS.has(cell.text)),
			),
		).toBe(true)
	})
})

describe('run_board_jump_paint.jump_cells — the run up', () => {
	it('ac-f86ed9ae whitens no lane row through the run up, painting every row alike', () => {
		const rows = [cell_at(30, 5), cell_at(30, 6)]

		expect(changed_off_bolts(rows, -20, SCENE)).toStrictEqual([])
	})

	it('ac-e24e55cd crosses no flare over the board at any tick of the run up', () => {
		const cells = grid(SCENE.rows).filter(
			(cell) => cell.y >= HEADER_ROWS && cell.y < SCENE.panel.top,
		)
		const ticks = Array.from({ length: LETTERS }, (_, index) => index - LETTERS)

		expect(ticks.every((t) => changed_off_bolts(cells, t, SCENE).length === 0)).toBe(true)
	})

	it('crackles arcs over the header rows in its last ticks, leaving the figure and other rows', () => {
		const cells = [...grid(10), cell_at(0, 0, { is_figure: true })]
		const moved = changed_off_bolts(cells, -1, SCENE)

		expect(moved.length).toBeGreaterThan(0)
		expect(moved.every((cell) => cell.y < HEADER_ROWS)).toBe(true)
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

describe('run_board_jump_paint.jump_cells — the time circuits roll', () => {
	it('spins the header clock white over the wash from 12 ticks past the jump', () => {
		const clock = [...'ET 19:52'].map((text, x) => cell_at(x, 0, { text }))
		const before = jump_cells(clock, 11, LETTERS, SCENE)
		const rolled = jump_cells(clock, 12, LETTERS, SCENE)

		expect(before.some((cell) => is_white(cell))).toBe(false)
		expect(rolled.filter((cell) => is_white(cell)).length).toBeGreaterThan(0)
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

	it('ac-2cf69f64 has every cell thawed by the last tick of its shorter thaw', () => {
		const cells = grid(SCENE.rows)

		expect(arrive_cells(cells, ARRIVE_TICKS - 1)).toStrictEqual(cells)
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
