import { describe, expect, it } from 'vitest'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'
import { run_board_theme_magi_opening } from './run-board-theme-magi-opening'

// joshuafolkken/kit#8917: the MAGI theme's start-up opening.

const { boot_look, magi_opening } = run_board_theme_magi_opening
const { HOST, KIT, fresh_grid, row_text, state_at } = run_board_theme_magi_fixture

describe('run_board_theme_magi_opening.boot_look', () => {
	it('flickers the frame on, fills the check bar, then shows ONLINE', () => {
		expect(boot_look(1, 21).text).toBe('')
		expect(boot_look(4, 24).text).toBe('CHECK ▮       ')
		expect(boot_look(13, 33).text).toBe('CHECK ▮▮▮▮▮▮▮▮')
		expect(boot_look(14, 34).text).toBe('ONLINE')
	})

	it('flashes white as ALL GREEN arrives', () => {
		expect(boot_look(30, 62).frame).toBe('255;255;255')
		expect(boot_look(30, 63).frame).toBe('90;200;120')
	})
})

describe('run_board_theme_magi_opening.magi_opening', () => {
	it('types the title on a dark screen', () => {
		const grid = fresh_grid()

		magi_opening(KIT).draw(grid, 3, state_at('i', 3))

		expect(row_text(grid, HOST.layout.screen_cy - 10).trim()).toBe('MAGI█')
		expect(row_text(grid, 0).trim()).toBe('')
	})

	it('leaves the board as it is once done', () => {
		const grid = fresh_grid()

		magi_opening(KIT).draw(grid, 110, state_at('i', 110))

		expect(grid).toStrictEqual(fresh_grid())
	})
})
