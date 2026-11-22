import { describe, expect, it } from 'vitest'
import { run_board_flux } from './run-board-flux'
import { run_board_paint_fixture } from './run-board-paint-fixture'
import { run_board_rgb } from './run-board-rgb'

// joshuafolkken/kit#8674: the flux capacitor's lamps in a Y, the light running in from the outer ends
// at each speed range's pace, and the red bar across the stem.

const { FLOOD, FLOOD_DIM, FLUX_LAMPS, FLUX_ROWS, FLUX_WIDTH, WHITE_TICKS, flux_cells, lamp_look } =
	run_board_flux
const { rgb_of } = run_board_paint_fixture
const MIN_CONTRAST = 4.5
const ORIGIN = { row: 10, column: 20 }
const LIT = '●'
const DIM = '∙'

function lamp_key(lamp: { row: number; column: number; step: number }): string {
	return `${String(lamp.step)} ${String(lamp.row)} ${String(lamp.column)}`
}

describe('run_board_flux.FLUX_LAMPS', () => {
	it('places each lamp at its step on the Y over seven rows and thirteen columns', () => {
		expect(FLUX_ROWS).toBe(7)
		expect(FLUX_WIDTH).toBe(13)
		expect(FLUX_LAMPS).toHaveLength(10)
		expect(new Set(FLUX_LAMPS.map((lamp) => lamp_key(lamp)))).toStrictEqual(
			new Set([
				'0 0 0',
				'0 0 12',
				'0 6 6',
				'1 1 2',
				'1 1 10',
				'1 5 6',
				'2 2 4',
				'2 2 8',
				'2 4 6',
				'3 3 6',
			]),
		)
	})
})

// joshuafolkken/kit#8712: the stem's three lamps lit one at a time from its bottom in to the middle.
function stem_at(tick: number): Array<string> {
	const cells = flux_cells(ORIGIN, tick, 0)

	return [14, 15, 16].map(
		(row) => cells.findLast((cell) => cell.row === row && cell.column === 26)?.text ?? '',
	)
}

describe('run_board_flux.flux_cells on the stem', () => {
	it('lights the bottom lamp, then the one above it, then the one under the middle', () => {
		expect(stem_at(0)).toStrictEqual([DIM, DIM, LIT])
		expect(stem_at(4)).toStrictEqual([DIM, LIT, DIM])
		expect(stem_at(8)).toStrictEqual([LIT, DIM, DIM])
	})

	it('lights the lamp under the middle at 60%, as each arm’s third step', () => {
		const top = flux_cells(ORIGIN, 8, 0).find((cell) => cell.row === 14 && cell.column === 26)

		expect(top?.fg).toStrictEqual({ rgb: '69;66;54', named: 'white' })
	})
})

describe('run_board_flux.lamp_look', () => {
	it('runs the light in from the outer ends a step every four ticks at 45% in the idle range', () => {
		expect(lamp_look(0, 0, 0)).toStrictEqual({ text: LIT, rgb: [115, 110, 90] })
		expect(lamp_look(3, 0, 0)).toStrictEqual({ text: LIT, rgb: [115, 110, 90] })
		expect(lamp_look(0, 1, 0)).toStrictEqual({ text: DIM, rgb: [78, 52, 20] })
		expect(lamp_look(4, 1, 0).text).toBe(LIT)
		// The third step at 60% of the range's light.
		expect(lamp_look(8, 2, 0)).toStrictEqual({ text: LIT, rgb: [69, 66, 54] })
		expect(lamp_look(12, 0, 0).text).toBe(LIT)
	})

	it('keeps the middle out at every tick in every range', () => {
		const ticks = Array.from({ length: 24 }, (_, tick) => tick)

		for (const range of [0, 1, 2, 3, 4]) {
			expect(ticks.map((tick) => lamp_look(tick, 3, range).text)).not.toContain(LIT)
		}
	})

	it('steps faster and brighter in the higher ranges', () => {
		expect(lamp_look(3, 1, 1)).toStrictEqual({ text: LIT, rgb: [153, 147, 120] })
		expect(lamp_look(2, 1, 2)).toStrictEqual({ text: LIT, rgb: [204, 196, 160] })
		expect(lamp_look(1, 1, 3)).toStrictEqual({ text: LIT, rgb: [255, 245, 200] })
		expect(lamp_look(1, 1, 4)).toStrictEqual({ text: LIT, rgb: [255, 245, 200] })
		expect(lamp_look(0, 1, 4)).toStrictEqual({ text: DIM, rgb: [144, 96, 36] })
	})
})

describe('run_board_flux.flux_cells', () => {
	it('draws the red bar on the sixth row, the stem’s middle, four columns either side of it', () => {
		const bar = flux_cells(ORIGIN, 0, 0).filter((cell) => cell.text === '━')

		expect(bar.map((cell) => cell.column)).toStrictEqual([22, 23, 24, 25, 26, 27, 28, 29, 30])
		expect(new Set(bar.map((cell) => cell.row))).toStrictEqual(new Set([15]))
		expect(bar[0]?.fg).toStrictEqual({ rgb: '70;16;24', named: 'red' })
	})

	it('draws the lamps after the bar, so the stem lamp stands over it', () => {
		const cells = flux_cells(ORIGIN, 0, 0)
		const on_stem = cells.filter((cell) => cell.row === 15 && cell.column === 26)

		expect(on_stem.map((cell) => cell.text)).toStrictEqual(['━', DIM])
		expect(cells.find((cell) => cell.row === 10 && cell.column === 20)).toStrictEqual({
			row: 10,
			column: 20,
			text: LIT,
			fg: { rgb: '115;110;90', named: 'white' },
		})
	})
})

// joshuafolkken/kit#8677: the capacitor through a jump — orange before the flood, a white box first,
// then white dots on a darkening gray, every one readable.

const WHITE = '255;255;255'
const DIM_TICK = 20
const STEM = { row: 15, column: 26 }
// The box reaches a column past either side of the picture; the bar is nine cells long.
const SIDES = 2
const BAR_LENGTH = 9

function flooded(
	flood: number,
): Array<{ row: number; column: number; text: string; bg: string | undefined }> {
	return flux_cells(ORIGIN, 0, 0, { flood, is_orange: false }).map((cell) => ({
		row: cell.row,
		column: cell.column,
		text: cell.text,
		bg: rgb_of(cell.bg),
	}))
}

describe('run_board_flux.flux_cells through a jump', () => {
	it('lights every lamp orange the two ticks before the flood', () => {
		const lamps = flux_cells(ORIGIN, 0, 0, { is_orange: true }).filter((cell) => cell.text === LIT)

		expect(lamps).toHaveLength(FLUX_LAMPS.length)
		expect(new Set(lamps.map((cell) => rgb_of(cell.fg)))).toStrictEqual(new Set(['230;110;60']))
	})

	it('washes the whole box white with no lamp drawn for the first ticks of the flood', () => {
		const cells = flooded(0)

		expect(new Set(cells.map((cell) => cell.bg))).toStrictEqual(new Set([WHITE]))
		expect(cells.some((cell) => cell.text === LIT)).toBe(false)
		expect(cells).toHaveLength(FLUX_ROWS * (FLUX_WIDTH + SIDES) + BAR_LENGTH + FLUX_LAMPS.length)
		// The box: seven rows of fifteen columns.
		expect(new Set(cells.map((cell) => cell.row))).toStrictEqual(
			new Set([10, 11, 12, 13, 14, 15, 16]),
		)
		expect(new Set(cells.map((cell) => cell.column)).size).toBe(15)
	})

	it('then stands white dots and a red bar on the darkening gray', () => {
		const first = flooded(WHITE_TICKS)
		const last = flooded(DIM_TICK)
		const stem = last.filter((cell) => cell.row === STEM.row && cell.column === STEM.column)

		expect(first[0]?.bg).toBe(FLOOD.join(';'))
		expect(last[0]?.bg).toBe(FLOOD_DIM.join(';'))
		expect(stem.map((cell) => cell.text)).toStrictEqual([' ', '━', LIT])
	})

	it('keeps a white dot at a contrast of at least 4.5 on both grays', () => {
		const white = run_board_rgb.parsed(WHITE)

		expect(run_board_rgb.contrast(white, FLOOD)).toBeGreaterThanOrEqual(MIN_CONTRAST)
		expect(run_board_rgb.contrast(white, FLOOD_DIM)).toBeGreaterThanOrEqual(MIN_CONTRAST)
	})
})
