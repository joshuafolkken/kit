import { describe, expect, it } from 'vitest'
import { run_board_theme_trace_data } from './run-board-theme-trace-data'
import { run_board_theme_trace_paint } from './run-board-theme-trace-paint'

// joshuafolkken/kit#8917: MATRIX's drop painter — head white to green, a tail eased to ember.

const { GLYPHS } = run_board_theme_trace_data
const { HEAD_PAINTS, glyph_at, mix, paint, paint_at, settled_glyph } = run_board_theme_trace_paint

describe('run_board_theme_trace_paint', () => {
	it('mixes two colors, the share held to 0..1', () => {
		const target = '100;200;50'

		expect(mix('0;0;0', target, 0.5)).toBe('50;100;25')
		expect(mix('0;0;0', target, 2)).toBe(target)
	})

	it('paints the three head cells, then the tail in its steps', () => {
		expect(paint_at(0, 10)).toBe(HEAD_PAINTS[0])
		expect(paint_at(2, 10)).toBe(HEAD_PAINTS[2])
		expect(paint_at(3, 10)).toBe(paint('0;255;65'))
		expect(paint_at(10, 10)).toBe(paint('0;22;5'))
	})

	it('keeps a trail cell’s settled glyph and flickers the lead', () => {
		expect(glyph_at(4, 7, 5, 1)).toBe(settled_glyph(4, 7))
		expect(glyph_at(4, 7, 5, 2)).toBe(glyph_at(4, 7, 5, 1))
		expect(GLYPHS).toContain(glyph_at(4, 7, 0, 1))
	})
})
