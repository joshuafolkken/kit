import { describe, expect, it } from 'vitest'
import { run_board_theme_trace_clock } from './run-board-theme-trace-clock'
import { run_board_theme_trace_fixture } from './run-board-theme-trace-fixture'

// joshuafolkken/kit#8917: MATRIX's running clocks count up a second at a time and flash.

const { BOARD, row_text, view_at } = run_board_theme_trace_fixture
const { clock_text, clocks_in, field_at, lay_clocks } = run_board_theme_trace_clock

describe('run_board_theme_trace_clock', () => {
	it('writes seconds, minutes and hours as the board does', () => {
		expect(clock_text(7)).toBe('7″')
		expect(clock_text(65)).toBe('1′05″')
		expect(clock_text(3725)).toBe('1°02′05″')
	})

	it('reads each clock back from its seconds mark, hours and minutes where marked', () => {
		const text = ' - 3°52′56″  9′ 15′39″ 12″ 4°07″ ″ x″'

		expect(clocks_in(text)).toStrictEqual([
			{ index: 3, right: 11, seconds: 13_976 },
			{ index: 16, right: 22, seconds: 939 },
			{ index: 23, right: 26, seconds: 12 },
			{ index: 27, right: 32, seconds: 14_407 },
		])
	})

	it('finds running clocks in the header and on the lanes', () => {
		expect(BOARD.clock_fields.length).toBeGreaterThan(1)
		expect(BOARD.clock_fields.some((field) => field.y < 3)).toBe(true)
	})

	it('right-aligns a field over its room', () => {
		const field = { y: 0, left: 0, right: 5, base: 58 }

		expect(field_at(field, 0)).toBe('  58″')
		expect(field_at(field, 3)).toBe('1′01″')
	})

	it('counts the clocks up once a second', () => {
		const field = BOARD.clock_fields[0] ?? { y: 0, left: 0, right: 0, base: 0 }
		const view = view_at('i', 40)

		lay_clocks(view)

		expect(field.right).toBeGreaterThan(field.left)
		expect(row_text(view, field.y).slice(field.left, field.right)).toBe(field_at(field, 2))
	})
})
