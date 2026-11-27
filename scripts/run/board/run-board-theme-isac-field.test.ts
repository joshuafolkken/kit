import { describe, expect, it } from 'vitest'
import { run_board_theme_draw, type Pane } from './run-board-theme-draw'
import type { Cell, Point } from './run-board-theme-host-types'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'
import { run_board_theme_isac_field, type Field } from './run-board-theme-isac-field'

// joshuafolkken/kit#9096: the isac theme's hexagonal dot field.

const { field_distance, hex_field } = run_board_theme_isac_field
const { BLANK } = run_board_theme_draw
const { INKS } = run_board_theme_isac_data
const WIDTH = 12
const HEIGHT = 2
const FAR_AWAY = { x: 1000, y: 1000 }
const LIT_REACH = 3

function cell_of(pane: Pane, at: Point): Cell {
	return pane.grid[at.y]?.[at.x] ?? BLANK
}

function pane_of(): Pane {
	const grid = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => BLANK))

	return { grid, box: { x: 0, y: 0, w: WIDTH, h: HEIGHT } }
}

function text_of(pane: Pane, y: number): string {
	return (pane.grid[y] ?? []).map(([ch]) => ch).join('')
}

describe('run_board_theme_isac_field.field_distance', () => {
	it('counts a column as half a row', () => {
		const center = { x: 10, y: 3 }

		expect(field_distance({ x: 14, y: 3 }, center)).toBe(2)
		expect(field_distance({ x: 10, y: 5 }, center)).toBe(2)
		expect(field_distance({ x: 6, y: 5 }, center)).toBeCloseTo(Math.hypot(2, 2))
	})
})

describe('run_board_theme_isac_field.hex_field', () => {
	it('puts a dot every fourth column, every other row shifted two', () => {
		const pane = pane_of()
		const field: Field = { center: FAR_AWAY, reach: 0, lit: 0 }

		hex_field(pane, field)

		expect(text_of(pane, 0)).toBe('·   ·   ·   ')
		expect(text_of(pane, 1)).toBe('  ·   ·   · ')
	})

	it('lights the dots out to its radius in orange and leaves the rest dim', () => {
		const pane = pane_of()

		hex_field(pane, { center: { x: 0, y: 0 }, reach: FAR_AWAY.x, lit: LIT_REACH })

		expect(cell_of(pane, { x: 0, y: 0 })[1]).toBe(INKS.ORANGE)
		expect(cell_of(pane, { x: 4, y: 0 })[1]).toBe(INKS.ORANGE)
		expect(cell_of(pane, { x: 8, y: 0 })[1]).toBe(INKS.DIM)
	})

	it('draws the ring where it passes, over a dot or a gap', () => {
		const pane = pane_of()

		hex_field(pane, { center: { x: 0, y: 0 }, reach: 1, lit: 0 })

		expect(cell_of(pane, { x: 0, y: 1 })).toStrictEqual(['∙', INKS.BRIGHT])
		expect(cell_of(pane, { x: 2, y: 0 })).toStrictEqual(['∙', INKS.BRIGHT])
		expect(cell_of(pane, { x: 1, y: 0 })).toStrictEqual(BLANK)
	})
})
