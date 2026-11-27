import { describe, expect, it } from 'vitest'
import { run_board_theme_ghost } from './run-board-theme-ghost'
import { run_board_theme_ghost_data } from './run-board-theme-ghost-data'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'

// joshuafolkken/kit#9096: the ghost theme.

const { HOST } = run_board_theme_host_fixture
const { fresh_grid, row_text, state_at } = run_board_theme_magi_fixture
const { ASSEMBLE, DRIFT, theme_colors, theme_notes } = run_board_theme_ghost_data
const TYPING = 20
const IDLE_TICK = 5
const BREACHED = 40

function level_after_draw(key: Exclude<DemoKey, 'o' | 'x'>, tick: number): string {
	const grid = fresh_grid()

	run_board_theme_ghost.theme(HOST.api).draw(grid, state_at(key, tick), tick)

	return row_text(grid, HOST.layout.level_spot.y)
}

describe('run_board_theme_ghost.theme', () => {
	it('names its board, spinner and colors', () => {
		const theme = run_board_theme_ghost.theme(HOST.api)

		expect(theme.name).toBe('GHOST')
		expect(theme.board).toBe('josh-ghost')
		expect(theme.spinner).toBe('4E7A1C9F2B')
		expect(theme.colors).toBe(theme_colors)
		expect(theme.notes).toBe(theme_notes)
	})

	it('carries its opening and its ending', () => {
		const theme = run_board_theme_ghost.theme(HOST.api)

		expect(theme.opening?.ticks).toBe(ASSEMBLE.ticks)
		expect(theme.ending?.ticks).toBe(DRIFT.ticks)
	})

	it('plays while a notice, a new lane or a progress line does, and not at idle', () => {
		const { playing } = run_board_theme_ghost.theme(HOST.api)

		expect(playing?.(state_at('n', TYPING))).toBe(true)
		expect(playing?.(state_at('r', TYPING))).toBe(true)
		expect(playing?.(state_at('p', TYPING))).toBe(true)
		expect(playing?.(state_at('i', TYPING))).toBe(false)
	})

	it('reads the level as stable, diving or breached', () => {
		expect(level_after_draw('i', IDLE_TICK)).toContain(' LINK STABLE')
		expect(level_after_draw('p', TYPING)).toContain(' LINK DIVING')
		expect(level_after_draw('n', BREACHED)).toContain(' BARRIER BREACH')
	})
})
