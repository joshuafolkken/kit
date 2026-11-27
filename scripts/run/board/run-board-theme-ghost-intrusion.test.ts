import { describe, expect, it } from 'vitest'
import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_ghost_data } from './run-board-theme-ghost-data'
import { run_board_theme_ghost_intrusion } from './run-board-theme-ghost-intrusion'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'

// joshuafolkken/kit#9096: the ghost theme's NOTICE, the intrusion.

const { intrusion, is_intruded, scrambled_share } = run_board_theme_ghost_intrusion
const { HOST } = run_board_theme_host_fixture
const { fresh_grid, state_at } = run_board_theme_magi_fixture
const { PEAK_TICKS } = run_board_theme_host_state
const { area_pane } = run_board_theme_draw
const { INKS, INTRUSION } = run_board_theme_ghost_data
const NOTICE_START = 10
const EARLY = 20
const LATE = 70
const BAR_TICK = 20

function draw_of(grid: Grid, state: ThemeState): ThemeDraw {
	return { api: HOST.api, grid, s: state, tick: state.tick }
}

// The notice `cooled` ticks after its typing.
function cooled_state(cooled: number): ThemeState {
	return state_at('n', NOTICE_START + PEAK_TICKS + cooled - 1)
}

function style_at(grid: Grid, x: number, y: number): string {
	return (grid[y] ?? [])[x]?.[1] ?? ''
}

function area_text(state: ThemeState): string {
	const grid = fresh_grid()
	const { box } = area_pane(draw_of(grid, state))

	intrusion(draw_of(grid, state))

	return grid
		.slice(box.y, box.y + box.h)
		.map((row) => row.map(([ch]) => ch).join(''))
		.join('\n')
}

describe('run_board_theme_ghost_intrusion.is_intruded', () => {
	it('plays through the notice and its play-out, not before or after', () => {
		expect(is_intruded(state_at('i', EARLY))).toBe(false)
		expect(is_intruded(state_at('n', 0))).toBe(false)
		expect(is_intruded(state_at('n', EARLY))).toBe(true)
		expect(is_intruded(cooled_state(INTRUSION.play - 1))).toBe(true)
		expect(is_intruded(cooled_state(INTRUSION.play))).toBe(false)
	})
})

describe('run_board_theme_ghost_intrusion.scrambled_share', () => {
	it('rises through the build to the most, holds, then restores to nothing', () => {
		const rising = [EARLY, LATE].map((tick) => scrambled_share(state_at('n', tick)))
		const restored = INTRUSION.restore_from + INTRUSION.restore_ticks

		expect(rising[0]).toBeLessThan(rising[1] ?? 0)
		expect(scrambled_share(cooled_state(0))).toBeCloseTo(INTRUSION.most)
		expect(scrambled_share(cooled_state(INTRUSION.restore_from))).toBeCloseTo(INTRUSION.most)
		expect(scrambled_share(cooled_state(restored))).toBeCloseTo(0)
	})
})

describe('run_board_theme_ghost_intrusion.intrusion', () => {
	it('labels the intrusion, then the barrier restoring, then restored', () => {
		const restoring = INTRUSION.restore_from + INTRUSION.restore_ticks / 2
		const restored = INTRUSION.restore_from + INTRUSION.restore_ticks

		expect(area_text(state_at('n', LATE))).toContain(INTRUSION.label)
		expect(area_text(cooled_state(restoring))).toContain(INTRUSION.restoring)
		expect(area_text(cooled_state(restored))).toContain(INTRUSION.restored)
	})

	it('scrambles blocks of the area into glyph noise at the peak', () => {
		const text = area_text(cooled_state(0))
		const noise = [...text].filter((ch) => INTRUSION.glyphs.includes(ch))

		expect(noise.length).toBeGreaterThan(0)
		expect(area_text(cooled_state(INTRUSION.restore_from + INTRUSION.restore_ticks))).not.toBe(text)
	})

	it('sweeps a cyan bar along the header while the notice plays', () => {
		const state = state_at('n', BAR_TICK)
		const grid = fresh_grid()
		const from = (BAR_TICK - NOTICE_START) * INTRUSION.bar_pace - INTRUSION.bar_w

		intrusion(draw_of(grid, state))

		expect(style_at(grid, from + 1, 0)).toBe(INKS.BAR)
		expect(style_at(grid, from + 1, INTRUSION.header_rows - 1)).toBe(INKS.BAR)
		expect(style_at(grid, from + 1, INTRUSION.header_rows)).not.toBe(INKS.BAR)
	})
})
