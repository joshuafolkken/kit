import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_fixture } from './run-board-theme-deviant-fixture'
import { run_board_theme_ghost_data } from './run-board-theme-ghost-data'
import { run_board_theme_ghost_parts } from './run-board-theme-ghost-parts'
import type { Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#9096: the ghost theme's opening and ending — the board assembling from digits
// behind a wave and a scan line, the characters drifting off as dots until the screen is empty.

const { ASSEMBLE, DRIFT, INKS } = run_board_theme_ghost_data
const { ending_of, opening_of, resolve_tick } = run_board_theme_ghost_parts
const { HOST, draw_at, fresh_grid, row_text, state_at } = run_board_theme_deviant_fixture
const OPENING = opening_of(HOST.api)
const ENDING = ending_of(HOST.api)
const MID_WAVE = 20

function part_frame(part: typeof OPENING, tick: number): Grid {
	const grid = fresh_grid()

	part.draw(grid, tick, state_at('i', 0))

	return grid
}

function screen_text(grid: Grid): string {
	return grid.map((_, y) => row_text(grid, y)).join('\n')
}

function letters_in(grid: Grid): number {
	return screen_text(grid).replaceAll(/\s/gu, '').length
}

describe('run_board_theme_ghost_parts.resolve_tick', () => {
	it('reaches the top left first and the bottom right last, mostly by row', () => {
		const { w, h } = HOST.layout
		const draw = draw_at('i', 0)

		expect(resolve_tick(draw, { x: 0, y: 0 })).toBe(0)
		expect(resolve_tick(draw, { x: w - 1, y: h - 1 })).toBeLessThan(ASSEMBLE.wave_ticks)
		expect(resolve_tick(draw, { x: 0, y: h - 1 })).toBeGreaterThan(
			resolve_tick(draw, { x: w - 1, y: 0 }),
		)
	})
})

describe('run_board_theme_ghost_parts.opening_of', () => {
	it('lasts the demo’s part ticks and is noted', () => {
		expect(OPENING.ticks).toBe(ASSEMBLE.ticks)
		expect(OPENING.note).toContain('flickering digits')
	})

	it('assembles from digits behind a scan line mid-wave', () => {
		const grid = part_frame(OPENING, MID_WAVE)

		expect(screen_text(grid)).toMatch(/[01]/u)
		expect(screen_text(grid)).toContain('─')
		expect(grid).not.toStrictEqual(HOST.board)
	})

	it('leaves the scan line bright over the board’s cells', () => {
		const grid = part_frame(OPENING, MID_WAVE)

		expect(grid.some((row) => row.some(([, ink]) => ink === INKS.WHITE))).toBe(true)
	})

	it('is the board itself once the wave has run', () => {
		expect(part_frame(OPENING, ASSEMBLE.wave_ticks)).toStrictEqual(HOST.board)
		expect(part_frame(OPENING, OPENING.ticks - 1)).toStrictEqual(HOST.board)
	})
})

describe('run_board_theme_ghost_parts.ending_of', () => {
	it('lasts its part’s ticks, with a note of its own', () => {
		expect(ENDING.ticks).toBe(DRIFT.ticks)
		expect(ENDING.note).toContain('drift upward')
	})

	it('turns the characters to drifting dots, thinning out', () => {
		const dots = part_frame(ENDING, DRIFT.delay)
		const thinner = part_frame(ENDING, DRIFT.gone - 1)

		expect(screen_text(dots)).toMatch(/[·∙:]/u)
		expect(letters_in(thinner)).toBeLessThan(letters_in(dots))
	})

	it('holds an empty screen once the dots are gone', () => {
		expect(letters_in(part_frame(ENDING, DRIFT.gone))).toBe(0)
		expect(letters_in(part_frame(ENDING, ENDING.ticks - 1))).toBe(0)
	})
})
