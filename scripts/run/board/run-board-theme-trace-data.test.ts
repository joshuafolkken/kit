import { describe, expect, it } from 'vitest'
import { run_board_theme_trace_data } from './run-board-theme-trace-data'

// joshuafolkken/kit#8917: MATRIX's tables keep the demo's shades and glyphs.

const { COLORS, FLASH, GLYPHS, HEAD_RGB, SHADE } = run_board_theme_trace_data

describe('run_board_theme_trace_data', () => {
	it('paints the board in the demo’s greens', () => {
		expect(COLORS).toMatchObject({ body: SHADE.body, rule: SHADE.mid, notice: SHADE.bright })
		expect(HEAD_RGB[0]).toBe(SHADE.head)
	})

	it('holds one glyph a code point', () => {
		expect(GLYPHS).toHaveLength(64)
		expect(FLASH.join('')).toBe('ｦｱｳｴｵｶｷｹｺｻ')
	})
})
