import { describe, expect, it } from 'vitest'
import { run_board_cells } from './run-board-cells'
import { run_board_change_flash } from './run-board-change-flash'
import { run_board_layer } from './run-board-layer'
import { run_board_layer_effects } from './run-board-layer-effects'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#8826: the effects still written as ANSI bytes, each a decor layer in the order
// the turns were written in.

const { over, under } = run_board_layer_effects
const { cells_of, char_text } = run_board_cells
const { NO_TYPING } = run_board_type_rows
const SIZE = { rows: 2, columns: 6 }
const START = Date.parse('2026-10-08T09:00:00.000Z')
const UNDER_COUNT = 2
const OVER_COUNT = 6
const QUIET = { spots: [], typing: NO_TYPING }
const FLASH_END_MS = START + run_board_change_flash.FADE_TICKS * run_board_change_flash.TICK_MS

describe('run_board_layer_effects.under / over', () => {
	it('gives the drop and jump under the spinners and six effects over them, all decor', () => {
		const layers = [...under(QUIET), ...over(QUIET)]

		expect(under(QUIET)).toHaveLength(UNDER_COUNT)
		expect(over(QUIET)).toHaveLength(OVER_COUNT)
		expect(layers.every((layer) => layer.is_decor)).toBe(true)
	})

	it('neither changes nor draws without its effect', () => {
		const canvas = cells_of(SIZE)

		for (const layer of [...under(QUIET), ...over(QUIET)]) {
			expect(layer.next_change_ms(START)).toBe(run_board_layer.NEVER)
			layer.draw(canvas, START)
		}

		expect(canvas).toStrictEqual(cells_of(SIZE))
	})

	it('draws a flash on its own ticks until the changed text is back', () => {
		const line = { key: 'a', row: 1, index: 0, prefix_columns: 0, text: 'a' }
		const base = run_board_change_flash.next(undefined, [line], START)
		const flash = run_board_change_flash.next(base, [{ ...line, text: 'b' }], START)
		const [flash_layer] = over({ ...QUIET, flash })
		const canvas = cells_of(SIZE)

		flash_layer?.draw(canvas, START)
		flash_layer?.draw(canvas, FLASH_END_MS)

		expect(flash_layer?.next_change_ms(START)).toBe(START + run_board_change_flash.TICK_MS)
		expect(char_text(canvas.chars[0] ?? 0)).toBe('b')
		expect(canvas.styles[0]).toBe(run_board_cells.DEFAULT_STYLE)
	})
})
