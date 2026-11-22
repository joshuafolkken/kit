import { describe, expect, it } from 'vitest'
import { run_board_flux_gauge } from './run-board-flux-gauge'
import { run_board_paint_fixture } from './run-board-paint-fixture'
import { run_board_rgb } from './run-board-rgb'

// joshuafolkken/kit#8674: the bttf lamp gauge — the speed ranges, each column's cells in braille, the
// red row once the top range settles, and the spring past a new height when the range changes.

const { BANDS, FLOOD_WHITE, bars_at, change_before, gauge_cells, range_of } = run_board_flux_gauge
const { rgb_of } = run_board_paint_fixture
const ORIGIN = { row: 3, column: 40 }
const CELLS = 6
const MIN_CONTRAST = 4.5
const CHANGE_TICK = 10

function constant(range: number): (tick: number) => number {
	return () => range
}

// The idle range up to `CHANGE_TICK`, the second from it.
function climbing(tick: number): number {
	return tick < CHANGE_TICK ? 0 : 1
}

function column_cells(range_at: (tick: number) => number, column: number): Array<string> {
	return gauge_cells(ORIGIN, 0, range_at)
		.filter((cell) => cell.column === ORIGIN.column + column)
		.map((cell) => cell.text)
}

describe('run_board_flux_gauge.range_of', () => {
	it('reads the range a speed is in, the top one from 87.5', () => {
		expect([0, 44.9, 45, 60, 75, 87.4, 87.5, 120].map((speed) => range_of(speed))).toStrictEqual([
			0, 0, 1, 2, 3, 3, 4, 4,
		])
	})
})

describe('run_board_flux_gauge.gauge_cells', () => {
	it('draws the idle first column as nine green lamps from the bottom', () => {
		const cells = gauge_cells(ORIGIN, 0, constant(0)).filter(
			(cell) => cell.column === ORIGIN.column,
		)

		expect(cells.map((cell) => cell.row)).toStrictEqual([3, 4, 5, 6, 7, 8])
		expect(cells.map((cell) => cell.text)).toStrictEqual([' ', ' ', ' ', '⣀', '⣿', '⣿'])
		expect(cells[4]).toMatchObject({
			fg: { rgb: '50;235;90', named: 'green' },
			bg: { rgb: '15;71;27', named: 'green' },
		})
	})

	it('leaves the third, fifth and eighth columns out at idle', () => {
		for (const column of [2, 4, 7]) {
			expect(column_cells(constant(0), column)).toStrictEqual(
				Array.from({ length: CELLS }, () => ' '),
			)
		}
	})

	it('lights the red row in the settled top range, but not in the ninth column', () => {
		const [red] = column_cells(constant(4), 0)

		expect(red).toBe('⣀')
		expect(column_cells(constant(4), 8)[0]).toBe(' ')
		expect(gauge_cells(ORIGIN, 0, constant(4))[0]?.fg).toStrictEqual({
			rgb: '255;80;60',
			named: 'red',
		})
	})

	it('keeps each band dot at a contrast of at least 4.5 on its ground', () => {
		for (const band of Object.values(BANDS)) {
			const ground = run_board_rgb.scaled(band.rgb, band.ground)

			expect(run_board_rgb.contrast(band.rgb, ground)).toBeGreaterThanOrEqual(MIN_CONTRAST)
		}
	})
})

describe('run_board_flux_gauge spring', () => {
	it('finds the last range change within the spring and the ticks since it', () => {
		expect(change_before(CHANGE_TICK - 1, climbing)).toBeUndefined()
		expect(change_before(CHANGE_TICK, climbing)).toStrictEqual({ before: 0, since: 0 })
		expect(change_before(CHANGE_TICK + 4, climbing)).toStrictEqual({ before: 0, since: 4 })
		expect(change_before(CHANGE_TICK + 6, climbing)).toBeUndefined()
	})

	it('springs a bar past its new height, under it, then settles, held on the board', () => {
		const heights = [0, 1, 4, 5].map(
			(since) => bars_at({ range: 1, change: { before: 0, since } })[0]?.green,
		)

		expect(heights).toStrictEqual([11, 12, 9, 10])
		expect(bars_at({ range: 1, change: { before: 0, since: 1 } })[8]?.green).toBe(12)
		expect(bars_at({ range: 1, change: undefined })[0]?.green).toBe(10)
	})

	it('holds the red row out while the top range is still springing', () => {
		expect(bars_at({ range: 4, change: { before: 3, since: 0 } })[0]?.is_red).toBe(false)
		expect(bars_at({ range: 4, change: undefined })[0]?.is_red).toBe(true)
	})
})

// joshuafolkken/kit#8677: the gauge through a jump — the climb to the top range, the flooded dots and the
// top green lamps' blink.

const TOP = 4
const CLIMB = 10
const BLINK_TICK = 2

function lit_cells(look: { is_flooded?: boolean }): Array<{ fg: string; bg: string }> {
	return gauge_cells(ORIGIN, 0, constant(TOP), look)
		.filter((cell) => cell.text !== ' ')
		.map((cell) => ({ fg: rgb_of(cell.fg) ?? '', bg: rgb_of(cell.bg) ?? '' }))
}

function climb_green(since: number): number | undefined {
	return bars_at({ range: TOP, change: { before: 0, since }, climb: CLIMB })[0]?.green
}

function texts(tick: number, range: number): Array<string> {
	return gauge_cells(ORIGIN, tick, constant(range)).map((cell) => cell.text)
}

describe('run_board_flux_gauge jump', () => {
	it('keeps every flooded dot at a contrast of at least 4.5 on its band ground', () => {
		const { contrast, parsed } = run_board_rgb
		const cells = lit_cells({ is_flooded: true })

		expect(cells.length).toBeGreaterThan(0)

		for (const cell of cells) {
			expect(contrast(parsed(cell.fg), parsed(cell.bg))).toBeGreaterThanOrEqual(MIN_CONTRAST)
		}
	})

	it('whitens the lit dots while flooded and leaves their ground as it was', () => {
		const plain = lit_cells({})
		const flooded = lit_cells({ is_flooded: true })

		const { mixed, parsed } = run_board_rgb
		const whiter = mixed(parsed(plain[0]?.fg ?? ''), parsed('255;255;255'), FLOOD_WHITE)

		expect(flooded.map((cell) => cell.bg)).toStrictEqual(plain.map((cell) => cell.bg))
		expect(flooded[0]?.fg).toBe(whiter.join(';'))
	})

	it('climbs evenly to the top range over the climb instead of springing past it', () => {
		const heights = Array.from({ length: CLIMB }, (_, since) => climb_green(since) ?? 0)
		const settled = bars_at({ range: TOP, change: undefined })[0]?.green

		expect(heights).toStrictEqual(heights.toSorted((first, second) => first - second))
		expect(heights[0]).toBeLessThan(settled ?? 0)
		expect(heights.at(-1)).toBe(settled)
	})

	it('blinks the full green bars out every other two ticks, settled on the top range only', () => {
		expect(texts(BLINK_TICK, TOP)).not.toStrictEqual(texts(0, TOP))
		expect(texts(BLINK_TICK * 2, TOP)).toStrictEqual(texts(0, TOP))
		expect(texts(BLINK_TICK, TOP - 1)).toStrictEqual(texts(0, TOP - 1))
	})
})
