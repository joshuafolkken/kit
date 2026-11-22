import { describe, expect, it } from 'vitest'
import { run_board_flux } from './run-board-flux'

// joshuafolkken/kit#8674: the flux capacitor's lamps in a Y, the light running in from the outer ends
// at each speed range's pace, and the red bar across the stem.

const { FLUX_LAMPS, FLUX_ROWS, FLUX_WIDTH, flux_cells, lamp_look } = run_board_flux
const ORIGIN = { row: 10, column: 20 }
const LIT = '●'
const DIM = '∙'

function lamp_key(lamp: { row: number; column: number; step: number }): string {
	return `${String(lamp.step)} ${String(lamp.row)} ${String(lamp.column)}`
}

describe('run_board_flux.FLUX_LAMPS', () => {
	it('places each lamp at its step on the Y over six rows and thirteen columns', () => {
		expect(FLUX_ROWS).toBe(6)
		expect(FLUX_WIDTH).toBe(13)
		expect(FLUX_LAMPS).toHaveLength(9)
		expect(new Set(FLUX_LAMPS.map((lamp) => lamp_key(lamp)))).toStrictEqual(
			new Set(['0 0 0', '0 0 12', '0 5 6', '1 1 2', '1 1 10', '1 4 6', '2 2 4', '2 2 8', '3 3 6']),
		)
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
	it('draws the red bar on the fifth row, four columns either side of the stem', () => {
		const bar = flux_cells(ORIGIN, 0, 0).filter((cell) => cell.text === '━')

		expect(bar.map((cell) => cell.column)).toStrictEqual([22, 23, 24, 25, 26, 27, 28, 29, 30])
		expect(new Set(bar.map((cell) => cell.row))).toStrictEqual(new Set([14]))
		expect(bar[0]?.fg).toStrictEqual({ rgb: '70;16;24', named: 'red' })
	})

	it('draws the lamps after the bar, so the stem lamp stands over it', () => {
		const cells = flux_cells(ORIGIN, 0, 0)
		const on_stem = cells.filter((cell) => cell.row === 14 && cell.column === 26)

		expect(on_stem.map((cell) => cell.text)).toStrictEqual(['━', DIM])
		expect(cells.find((cell) => cell.row === 10 && cell.column === 20)).toStrictEqual({
			row: 10,
			column: 20,
			text: LIT,
			fg: { rgb: '115;110;90', named: 'white' },
		})
	})
})
