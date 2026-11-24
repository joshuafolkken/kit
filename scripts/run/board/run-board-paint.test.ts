import { WriteStream } from 'node:tty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_paint, type Paint } from './run-board-paint'

// joshuafolkken/kit#8897: a frame that paints thousands of cells reads stdout's color depth once
// (`painter`), and paints each cell as `painted` would.

const { painted, painter } = run_board_paint
const SHADE = run_board_labels.GAUGE_SHADES.normal
const PAINTS: ReadonlyArray<Paint | undefined> = [SHADE, 'cyan', 'dim', undefined]
const CELLS = 100
const GLYPH = '■'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('run_board_paint.painter', () => {
	it.each(['0', '1', '3'])('paints every color as painted does with FORCE_COLOR=%s', (level) => {
		vi.stubEnv('FORCE_COLOR', level)
		const paint = painter()

		for (const color of PAINTS) expect(paint(color, GLYPH)).toBe(painted(color, GLYPH))
		expect(paint(SHADE, '')).toBe('')
	})

	it('reads the color depth once however many cells it paints', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const depth = vi.spyOn(WriteStream.prototype, 'getColorDepth')
		const paint = painter()

		for (let cell = 0; cell < CELLS; cell += 1) paint(SHADE, GLYPH)

		expect(depth).toHaveBeenCalledTimes(1)
	})
})
