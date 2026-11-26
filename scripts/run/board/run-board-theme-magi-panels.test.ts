import { describe, expect, it } from 'vitest'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'
import { run_board_theme_magi_panels } from './run-board-theme-magi-panels'

// joshuafolkken/kit#8917: what each of the MAGI theme's three panels shows.

const { idle_look, magi_panels, panel_look, verdict_of } = run_board_theme_magi_panels
const { KIT, fresh_grid, row_text, state_at } = run_board_theme_magi_fixture

describe('run_board_theme_magi_panels.verdict_of', () => {
	it('reads each panel’s verdict, the table repeating after four lines', () => {
		expect([0, 1, 2].map((panel) => verdict_of(0, panel))).toStrictEqual([1, 1, 0])
		expect(verdict_of(4, 2)).toBe(0)
		expect(verdict_of(1, 2)).toBe(1)
	})
})

describe('run_board_theme_magi_panels.idle_look', () => {
	it('runs the self-check, then ALL GREEN, then stands by', () => {
		expect(idle_look(8, 0).text).toBe('CHECK ▮▮    ')
		expect(idle_look(24, 0).text).toBe('ALL GREEN')
		expect(idle_look(40, 0).text).toBe('STANDBY')
	})

	it('runs each panel’s self-check a third of the cycle apart', () => {
		expect(idle_look(67, 1).text).toBe('CHECK       ')
	})
})

describe('run_board_theme_magi_panels.panel_look', () => {
	it('deliberates while the progress line types', () => {
		expect(panel_look(state_at('p', 12), 12, 0).text).toBe('DELIBERATING')
	})

	it('shows ALERT during a notice and MONITORING while a lane syncs', () => {
		expect(panel_look(state_at('n', 30), 30, 1).text).toBe('ALERT')
		expect(panel_look(state_at('r', 30), 30, 2).text).toBe('MONITORING')
	})
})

describe('run_board_theme_magi_panels.magi_panels', () => {
	it('labels the links MAGI between the panels', () => {
		const grid = fresh_grid()

		magi_panels(KIT, grid, state_at('i', 40), 40)

		expect(row_text(grid, 8)).toContain(' MAGI ')
		expect(row_text(grid, 5)).toContain('BALTHASAR·2')
	})
})
