import { describe, expect, it } from 'vitest'
import { run_board_theme_host_api } from './run-board-theme-host-api'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: what the theme host hands a theme — its helpers bound to the layout.

const { HOST } = run_board_theme_host_fixture
const { plain_of, theme_api_of } = run_board_theme_host_api
const api = theme_api_of(HOST.layout, HOST.board)

function board_copy(): Grid {
	return HOST.board.map((row) => [...row])
}

describe('run_board_theme_host_api.theme_api_of', () => {
	it('hands over the layout and the board as they are', () => {
		expect(api.layout).toBe(HOST.layout)
		expect(api.board).toBe(HOST.board)
	})

	it('reads a board row as text', () => {
		expect(api.plain(0)).toBe(plain_of(HOST.board, 0))
		expect(api.plain(0).startsWith('> josh-')).toBe(true)
		expect(api.plain(999)).toBe('')
	})
})

describe('run_board_theme_host_api bound helpers', () => {
	it('clears the event area, all of it or the columns asked for', () => {
		const { area_top, area_end, edge } = HOST.layout
		const whole = board_copy()
		const part = board_copy()

		api.clear_area(whole)
		api.clear_area(part, 10, 20)

		expect(
			whole
				.slice(area_top, area_end + 1)
				.every((row) => row.slice(0, edge).every(([ch]) => ch === ' ')),
		).toBe(true)
		expect(whole[area_end + 1]).toStrictEqual(HOST.board[area_end + 1])
		expect(part[area_top]?.slice(10, 20).every(([ch]) => ch === ' ')).toBe(true)
		expect(part[area_top]?.slice(0, 10)).toStrictEqual(HOST.board[area_top]?.slice(0, 10))
	})

	it('blanks a row and the screen to the layout’s width', () => {
		const grid = board_copy()

		api.blank_row(grid, 3)
		api.blank_screen(grid)

		expect(grid).toHaveLength(HOST.layout.h)
		expect(
			grid.every((row) => row.length === HOST.layout.w && row.every(([ch]) => ch === ' ')),
		).toBe(true)
	})

	it('builds the tube’s parts for the layout', () => {
		expect(api.tube_on.ticks).toBe(42)
		expect(api.tube_off.ticks).toBe(66)
	})
})
