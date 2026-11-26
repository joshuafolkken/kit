import { describe, expect, it } from 'vitest'
import { run_board_theme_trace_decode } from './run-board-theme-trace-decode'
import { run_board_theme_trace_fixture } from './run-board-theme-trace-fixture'
import { run_board_theme_trace_paint } from './run-board-theme-trace-paint'

// joshuafolkken/kit#8917: MATRIX's typing — the glow, the decode and the notice lock.

const { HOST, board_cell, cell_of, view_at } = run_board_theme_trace_fixture
const { decode, notice_lock, type_glow } = run_board_theme_trace_decode
const { BRIGHT_ON, DARK_ON, HEAD_ON } = run_board_theme_trace_paint
const { layout } = HOST

describe('run_board_theme_trace_decode', () => {
	it('glows the typed line, its newest letters head white', () => {
		const view = view_at('p', 20)
		const { length } = view.s.progress

		type_glow(view)

		expect(cell_of(view, layout.progress.y, layout.progress.x)[1]).toBe(BRIGHT_ON)
		expect(cell_of(view, layout.progress.y, layout.progress.x + length - 1)[1]).toBe(HEAD_ON)
	})

	it('decodes the new lane out of dark glyphs, its next two cells its own in white', () => {
		const view = view_at('r', 20)
		const x = layout.row.x + view.s.row.length

		decode(view)

		expect(cell_of(view, layout.row.y, x)).toStrictEqual([board_cell(layout.row.y, x)[0], HEAD_ON])
		expect(cell_of(view, layout.row.y, view.row_last - 1)[1]).toBe(DARK_ON)
	})

	it('spins the notice’s unlocked letters in head white', () => {
		const view = view_at('n', 15)
		const x = layout.notice.x + view.s.notice_text.length

		notice_lock(view)

		expect(cell_of(view, layout.notice.y, x)[1]).toBe(HEAD_ON)
	})
})
