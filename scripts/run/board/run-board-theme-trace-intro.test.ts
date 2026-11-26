import { describe, expect, it } from 'vitest'
import { run_board_theme_trace_fixture } from './run-board-theme-trace-fixture'
import { run_board_theme_trace_intro } from './run-board-theme-trace-intro'
import { run_board_theme_trace_pass } from './run-board-theme-trace-pass'

// joshuafolkken/kit#8917: MATRIX's opening types its lead lines and knocks; its ending wipes the board.

const { HOST, board_copy, view_at } = run_board_theme_trace_fixture
const IDLE_STATE = view_at('i', 0).s
const { ending_of, intro_line, opening_of } = run_board_theme_trace_intro
const FALLEN = run_board_theme_trace_pass.fallen_of()

describe('run_board_theme_trace_intro', () => {
	it('types each lead with its cursor, holds it, erases it, then knocks', () => {
		expect(intro_line(0)).toBe('W█')
		expect(intro_line(15)).toBe('Wake up, Josh...█')
		expect(intro_line(16 + 22)).toBe('')
		expect(intro_line(500)).toBe('Knock, knock, Josh.')
	})

	it('draws the lead line on an empty screen', () => {
		const grid = board_copy()

		opening_of(HOST.api, FALLEN).draw(grid, 3, IDLE_STATE)

		expect(
			grid[0]
				?.map(([ch]) => ch)
				.join('')
				.trimEnd(),
		).toBe('Wake█')
		expect(grid[1]?.every(([ch]) => ch === ' ')).toBe(true)
	})

	it('ends on a second of empty screen', () => {
		const ending = ending_of(HOST.api, FALLEN)
		const grid = board_copy()

		ending.draw(grid, ending.ticks - 1, IDLE_STATE)

		expect(grid.every((row) => row.every(([ch]) => ch === ' '))).toBe(true)
	})
})
