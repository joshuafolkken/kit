import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_fixture } from './run-board-theme-deviant-fixture'
import { run_board_theme_deviant_opening } from './run-board-theme-deviant-opening'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#9096: the deviant theme's opening — the date card, the ice-white menu, the
// chapter card and the light bars lifting off the board.

const { faded, ice_at, opening_of } = run_board_theme_deviant_opening
const { RGB } = run_board_theme_deviant_data
const { fg } = run_board_theme_host_grid
const { HOST, fresh_grid, row_text, state_at } = run_board_theme_deviant_fixture
const OPENING = opening_of(HOST.api)
const MENU_TICK = 40
const CHAPTER_TICK = 80

function frame_at(tick: number): Grid {
	const grid = fresh_grid()

	OPENING.draw(grid, tick, state_at('i', 0))

	return grid
}

function screen_text(grid: Grid): string {
	return grid.map((_, y) => row_text(grid, y)).join('\n')
}

describe('run_board_theme_deviant_opening.opening_of', () => {
	it('lasts through the reveal', () => {
		expect(OPENING.ticks).toBe(134)
	})

	it('types the date card on an empty screen', () => {
		const text = screen_text(frame_at(5))

		expect(text).toContain('NOV 24TH')
		expect(text).not.toContain('throughput')
	})

	it('shows the menu’s title and items on the ice', () => {
		const text = screen_text(frame_at(MENU_TICK))

		expect(text).toContain('D E T R O I T')
		expect(text).toContain('CONTINUE')
	})

	it('stands the chapter card with the first lane’s plate', () => {
		const text = screen_text(frame_at(CHAPTER_TICK))

		expect(text).toContain('J O S H - R K 8 0 0')
		expect(text).toContain('#8899')
	})

	it('ends on the board', () => {
		expect(frame_at(OPENING.ticks - 1)).toStrictEqual(HOST.board)
	})
})

describe('run_board_theme_deviant_opening.ice_at', () => {
	it('is the night with no share, ice with all of it', () => {
		expect(ice_at(0, 0)).toBe(RGB.night)
		expect(ice_at(0, 1)).not.toBe(RGB.night)
	})
})

describe('run_board_theme_deviant_opening.faded', () => {
	it('comes in from the ice to the color', () => {
		expect([faded(RGB.blue, 0), faded(RGB.blue, 1)]).toStrictEqual([
			fg(RGB.ice_bright),
			fg(RGB.blue),
		])
	})
})
