import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'
import { run_board_theme_wopr_led } from './run-board-theme-wopr-led'

const { LED } = run_board_theme_wopr_data
const { board_grid, state_at } = run_board_theme_wopr_fixture
const { LETTER_POOL, LED_ROWS, led, matched, notice_look, pixels_of, rank_of, row_look, spin } =
	run_board_theme_wopr_led

function drawn(lit: Array<Array<boolean>>): Array<string> {
	return lit.map((row) => row.map((is_on) => (is_on ? '#' : '.')).join(''))
}

describe('run_board_theme_wopr_led', () => {
	it('lights a 1 on its right side and joins its corners', () => {
		expect(drawn(pixels_of('1'))).toStrictEqual(['....#', '....#', '....#', '....#', '....#'])
	})

	it('lights an 8 as a full figure with a middle bar', () => {
		expect(drawn(pixels_of('8'))).toStrictEqual(['#####', '#...#', '#####', '#...#', '#####'])
	})

	it('draws a character six rows of half blocks, a dark one all ghost', () => {
		const grid = board_grid()

		led(grid, { y: 0, x: 0 }, 'C', undefined)

		expect(LED_ROWS).toBe(6)
		expect(grid[0]?.[0]).toStrictEqual(['▀', `\u{1B}[38;2;${LED.ghost}m\u{1B}[48;2;${LED.ghost}m`])
	})

	it('spins a digit slot through digits and a letter slot through letters', () => {
		expect('0123456789').toContain(spin(3, 10))
		expect(LETTER_POOL).toContain(spin(0, 10))
	})

	it('ranks the positions in WOPR’s order', () => {
		expect(rank_of(6)).toBe(0)
		expect(rank_of(5)).toBe(9)
	})

	it('locks at most eight positions while a lane types', () => {
		const state = state_at('r', 10 + 200)

		expect(matched(row_look(state, 210))).toBeLessThanOrEqual(8)
	})

	it('matches the whole code by the NOTICE’s fiftieth tick', () => {
		const start = state_at('n', 10)
		const matching = state_at('n', 60)

		expect(matched(notice_look(start, 10))).toBe(0)
		expect(matched(notice_look(matching, 60))).toBe(10)
	})
})
