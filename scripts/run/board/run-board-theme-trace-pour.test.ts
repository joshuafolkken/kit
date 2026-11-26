import { describe, expect, it } from 'vitest'
import { run_board_theme_trace_fixture } from './run-board-theme-trace-fixture'
import { run_board_theme_trace_pour } from './run-board-theme-trace-pour'

// joshuafolkken/kit#8917: MATRIX's pours — a progress line's light rain, a lane's, a notice's wall.

const { view_at } = run_board_theme_trace_fixture
const { falls_of, gained, notice_pour, notice_pour_of, pours_of } = run_board_theme_trace_pour

describe('run_board_theme_trace_pour', () => {
	it('gains one more pace each second once its pour has ended', () => {
		expect(gained(10, 20)).toBe(0)
		expect(gained(39, 20)).toBe(0)
		expect(gained(45, 20)).toBe(5)
		expect(gained(60, 20)).toBe(20 + 0)
	})

	it('grows a notice’s pour to the burst at its peak, then lets it fall away', () => {
		expect(notice_pour(80, 80)).toBe(20)
		expect(notice_pour(99, 80)).toBe(20)
		expect(notice_pour(129, 80)).toBe(0)
	})

	it('pours what the state holds', () => {
		expect(pours_of(view_at('i', 40).s, 40)).toHaveLength(0)
		expect(pours_of(view_at('n', 40).s, 40)).toHaveLength(1)
	})

	it('covers the board with code only over the burst', () => {
		const pour = notice_pour_of(view_at('n', 40).s.notice)
		const falls = falls_of(pour, 90, 91)

		expect(falls).toHaveLength(20)
		expect(falls.every((fall) => fall.covers === true)).toBe(true)
	})
})
