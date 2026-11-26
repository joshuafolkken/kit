import { describe, expect, it } from 'vitest'
import { run_board_theme_trace_fixture } from './run-board-theme-trace-fixture'
import { run_board_theme_trace_flash } from './run-board-theme-trace-flash'
import { run_board_theme_trace_paint } from './run-board-theme-trace-paint'

// joshuafolkken/kit#8917: MATRIX's peak — deja vu's two bursts and the change flash's waves.

const { HOST, cell_of, row_text, view_at } = run_board_theme_trace_fixture
const { burst_of, change_flash, deja_vu, flash_age, flash_cell } = run_board_theme_trace_flash
const { HEAD_ON } = run_board_theme_trace_paint
const { layout } = HOST
// The notice event's first tick past its peak.
const PEAK_TICK = 90

describe('run_board_theme_trace_flash', () => {
	it('bursts twice: from the peak, and again a little after', () => {
		expect([0, 2, 3, 8, 10, 11].map((age) => burst_of(age))).toStrictEqual([0, 0, -1, 1, 1, -1])
	})

	it('draws the lane rows three columns right in head white', () => {
		const view = view_at('n', PEAK_TICK)
		const [y = 0] = layout.lane_rows
		const before = row_text(view, y)

		deja_vu(view)

		expect(cell_of(view, y, 10)[1]).toBe(HEAD_ON)
		expect(row_text(view, y).slice(3)).not.toBe(before)
	})

	it('flashes a printable character as a katakana, then fades it', () => {
		const view = view_at('n', PEAK_TICK)

		flash_cell(view, { x: 0, y: 6 }, ['A', 'body'], { age: 0, tick: 0 })
		flash_cell(view, { x: 1, y: 6 }, ['A', 'body'], { age: 5, tick: 0 })

		expect(cell_of(view, 6, 0)).toStrictEqual(['ｱ', HEAD_ON])
		expect(cell_of(view, 6, 1)[0]).toBe('A')
	})

	it('flashes nothing before the peak', () => {
		const view = view_at('n', 40)

		expect(flash_age(view.s, 10, 10)).toBe(-1)
		change_flash(view)

		expect(row_text(view, 10)).toBe(HOST.api.plain(10))
	})
})
