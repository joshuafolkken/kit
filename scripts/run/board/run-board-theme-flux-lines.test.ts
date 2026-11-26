import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_fixture } from './run-board-theme-flux-fixture'
import { run_board_theme_flux_lines } from './run-board-theme-flux-lines'

// joshuafolkken/kit#8917: the BTTF theme's typed lines arrive cold and thaw, as the demo's did.

const { arrive_line, draw_progress, draw_row, flash_level, letter_share } =
	run_board_theme_flux_lines
const { CONTEXT, HOST, board_grid, row_text, state_at } = run_board_theme_flux_fixture
const { notice, progress, row } = CONTEXT.lines

describe('run_board_theme_flux_lines', () => {
	it('flashes three times as a line starts, the row’s burst coming back', () => {
		expect([0, 2, 3, 6, 9].map((age) => flash_level(progress, age))).toStrictEqual([
			0.35,
			undefined,
			0.65,
			1,
			undefined,
		])
		expect(flash_level(progress, 36)).toBeUndefined()
		expect(flash_level(row, 36)).toBe(0.35)
	})

	it('holds a letter white, then thaws it in quarter steps', () => {
		expect(letter_share(row, 1, 0)).toBe(0)
		expect(letter_share(row, 2 + 10, 0)).toBe(0.5)
		expect(letter_share(notice, 3, 0)).toBe(0)
	})

	it('puts the cursor after the typed letters', () => {
		const grid = board_grid()
		const typed = state_at('r', 20).row

		arrive_line(grid, row, typed, 20)

		expect(row_text(grid, row.y)[row.x + typed.length]).toBe('█')
	})

	it('draws PROGRESS and ROW only while they play', () => {
		const idle = board_grid()

		draw_progress(CONTEXT, idle, state_at('i', 20), 20)
		draw_row(CONTEXT, idle, state_at('i', 20), 20)

		expect(idle).toStrictEqual(board_grid())
		expect(HOST.layout.progress.y).toBe(progress.y)
	})
})
