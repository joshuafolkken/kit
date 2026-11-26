import { describe, expect, it } from 'vitest'
import { run_board_theme_trace_fixture } from './run-board-theme-trace-fixture'
import { run_board_theme_trace_rain } from './run-board-theme-trace-rain'

// joshuafolkken/kit#8917: MATRIX's rain painter keeps off the typed text and paints the panel.

const { HOST, board_cell, cell_of, row_text, view_at } = run_board_theme_trace_fixture
const { draw_idle, idle_heads_fixed, may_paint, paint_column } = run_board_theme_trace_rain
const { layout } = HOST

describe('run_board_theme_trace_rain', () => {
	it('keeps rain off the progress line and, outside a NOTICE, the header', () => {
		const view = view_at('i', 0)

		expect(may_paint(view, layout.progress.x, layout.progress.y)).toBe(false)
		expect(may_paint(view, layout.px, 0)).toBe(false)
		expect(may_paint(view, layout.px, layout.area_top)).toBe(true)
	})

	it('paints a covering drop’s cells down its column, its head lowest', () => {
		const view = view_at('i', 0)
		const x = layout.px

		paint_column(view, { x, top: 10, rows: 5 }, { row: 2, trail: 2, frame: 0, covers: true })

		expect(cell_of(view, 12, x)[1]).not.toBe(board_cell(12, x)[1])
		expect(cell_of(view, 13, x)).toStrictEqual(board_cell(13, x))
	})

	it('runs every panel drop at the pour’s pace while a line types', () => {
		expect(idle_heads_fixed(4, 1, true, 10).trail).toBe(3)
		expect(idle_heads_fixed(4, 2, true, 10).row).not.toBe(idle_heads_fixed(4, 2, false, 10).row)
	})

	it('draws rain into the panel only', () => {
		const view = view_at('i', 40)

		draw_idle(view)

		expect(row_text(view, 0)).toBe(HOST.api.plain(0))
	})
})
