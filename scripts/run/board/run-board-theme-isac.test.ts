import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_isac } from './run-board-theme-isac'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'

// joshuafolkken/kit#9096: the isac theme.

const { HOST } = run_board_theme_host_fixture
const { fresh_grid, row_text, state_at } = run_board_theme_magi_fixture
const { FLARE, OPEN, theme_colors, theme_notes } = run_board_theme_isac_data
const TYPING = 20
const IDLE_TICK = 5

function level_after_draw(key: Exclude<DemoKey, 'o' | 'x'>, tick: number): string {
	const grid = fresh_grid()

	run_board_theme_isac.theme(HOST.api).draw(grid, state_at(key, tick), tick)

	return row_text(grid, HOST.layout.level_spot.y)
}

describe('run_board_theme_isac.theme', () => {
	it('names its board, capitals and colors', () => {
		const theme = run_board_theme_isac.theme(HOST.api)

		expect(theme.name).toBe('ISAC')
		expect(theme.board).toBe('josh-isac')
		expect(theme.capitals).toBe(true)
		expect(theme.colors).toBe(theme_colors)
		expect(theme.notes).toBe(theme_notes)
	})

	it('carries its opening and its ending', () => {
		const theme = run_board_theme_isac.theme(HOST.api)

		expect(theme.opening?.ticks).toBe(OPEN.ticks)
		expect(theme.ending?.ticks).toBe(FLARE.ticks)
	})

	it('plays while a notice, a new lane or a progress line does, and not at idle', () => {
		const { playing } = run_board_theme_isac.theme(HOST.api)

		expect(playing?.(state_at('n', TYPING))).toBe(true)
		expect(playing?.(state_at('r', TYPING))).toBe(true)
		expect(playing?.(state_at('p', TYPING))).toBe(true)
		expect(playing?.(state_at('i', TYPING))).toBe(false)
	})

	it('reads the level as secure, active or alert', () => {
		expect(level_after_draw('i', IDLE_TICK)).toContain(' STATUS SECURE')
		expect(level_after_draw('p', TYPING)).toContain(' STATUS ACTIVE')
		expect(level_after_draw('n', TYPING)).toContain(' STATUS ALERT')
	})
})
