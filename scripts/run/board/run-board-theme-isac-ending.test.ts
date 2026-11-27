import { describe, expect, it } from 'vitest'
import { run_board_theme_draw } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'
import { run_board_theme_isac_ending } from './run-board-theme-isac-ending'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'

// joshuafolkken/kit#9096: the isac theme's ending, the signal flare.

const { ending_of } = run_board_theme_isac_ending
const { HOST } = run_board_theme_host_fixture
const { fresh_grid, state_at } = run_board_theme_magi_fixture
const { is_drawn } = run_board_theme_draw
const { FLARE, INKS } = run_board_theme_isac_data
const RISEN = FLARE.rise_ticks - 1
const CLOSING = FLARE.close_from + FLARE.close_ticks / 2

function ended_at(tick: number): Grid {
	const grid = fresh_grid()

	ending_of(HOST.api).draw(grid, tick, state_at('i', tick))

	return grid
}

function drawn_count(grid: Grid): number {
	return grid.flat().filter((cell) => is_drawn(cell)).length
}

describe('run_board_theme_isac_ending.ending_of', () => {
	it('plays as long as the table says', () => {
		expect(ending_of(HOST.api).ticks).toBe(FLARE.ticks)
	})

	it('raises the flare from the bottom row, its head reaching the middle', () => {
		const { screen_cx, screen_cy, h } = HOST.layout
		const grid = ended_at(RISEN)

		expect(grid[screen_cy]?.[screen_cx]?.[0]).toBe('▲')
		expect(grid[h - 1]?.[screen_cx]).toStrictEqual(['│', INKS.BRIGHT])
	})

	it('closes a ring on the middle, taking the board outside it', () => {
		const whole = drawn_count(fresh_grid())

		expect(drawn_count(ended_at(CLOSING))).toBeLessThan(whole)
		expect(drawn_count(ended_at(FLARE.gone - 1))).toBeLessThan(drawn_count(ended_at(CLOSING)))
		expect(
			ended_at(CLOSING)
				.flat()
				.some(([ch]) => ch === '∙'),
		).toBe(true)
	})

	it('holds an empty screen once the ring is gone', () => {
		expect(drawn_count(ended_at(FLARE.gone))).toBe(0)
		expect(drawn_count(ended_at(FLARE.ticks - 1))).toBe(0)
	})
})
