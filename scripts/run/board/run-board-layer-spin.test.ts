import { describe, expect, it } from 'vitest'
import { run_board_cells } from './run-board-cells'
import { run_board_colon } from './run-board-colon'
import { run_board_labels } from './run-board-labels'
import { run_board_layer_spin } from './run-board-layer-spin'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#8826: the spinners and colons as a layer of the moment alone, restyled by the
// theme; a board in no theme draws them so (a themed one draws its own, joshuafolkken/kit#8917).

const { spin_layer } = run_board_layer_spin
const { cells_of, char_text } = run_board_cells
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
const { NO_TYPING } = run_board_type_rows
const SIZE = { rows: 2, columns: 6 }
const SPOT = { row: 1, column: 2, style: '' }
const COLON = { row: 2, column: 3, style: '' }
const START = SPINNER_INTERVAL_MS * run_board_colon.COLON_MS

function same(text: string): string {
	return text
}

describe('run_board_layer_spin.spin_layer', () => {
	it('draws the spinner of the moment at its spot', () => {
		const layer = spin_layer({ spots: [SPOT], typing: NO_TYPING }, same)
		const canvas = cells_of(SIZE)

		layer.draw(canvas, START + SPINNER_INTERVAL_MS)

		expect(char_text(canvas.chars[1] ?? 0)).toBe(spinner_of(START + SPINNER_INTERVAL_MS))
		expect(layer.is_decor).toBe(false)
	})
	it('draws the colons at theirs', () => {
		const layer = spin_layer({ spots: [], typing: NO_TYPING, colons: [COLON] }, same)
		const canvas = cells_of(SIZE)

		layer.draw(canvas, START)

		expect(char_text(canvas.chars[SIZE.columns + 2] ?? 0)).toBe(':')
	})
	it('draws what the theme restyles', () => {
		const seen: Array<string> = []
		const layer = spin_layer({ spots: [SPOT], typing: NO_TYPING }, (text) => {
			seen.push(text)

			return ''
		})
		const canvas = cells_of(SIZE)

		layer.draw(canvas, START)

		expect(seen).toHaveLength(1)
		expect(canvas).toStrictEqual(cells_of(SIZE))
	})
	it('changes on the spinner’s next step, the colons’ coming later', () => {
		const layer = spin_layer({ spots: [SPOT], typing: NO_TYPING, colons: [COLON] }, same)

		expect(layer.next_change_ms(START + 1)).toBe(START + SPINNER_INTERVAL_MS)
	})
})
