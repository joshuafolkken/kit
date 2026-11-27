import { describe, expect, it } from 'vitest'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_fixture } from './run-board-theme-rk800-fixture'
import { run_board_theme_rk800_wall } from './run-board-theme-rk800-wall'

// joshuafolkken/kit#9096: the rk800 theme's NOTICE — the red wall of orders, its hits and its wash.

const { build, glitched, grid_glyph, hits_passed, is_hit, wall_age, wall_wash } =
	run_board_theme_rk800_wall
const { RGB } = run_board_theme_rk800_data
const { code_points } = run_board_theme_host_grid
const { HOST, draw_at, row_text, state_at } = run_board_theme_rk800_fixture
// The demo's NOTICE starts typing on tick 10; the wall starts twenty ticks in and peaks at eighty.
const START = 10
const WALL_FROM = 20
const PEAK = 80
const LAST_HIT = 29

describe('run_board_theme_rk800_wall.wall_age', () => {
	it('counts from the notice’s start, -1 while none plays', () => {
		expect(wall_age(state_at('n', START + WALL_FROM), START + WALL_FROM)).toBe(WALL_FROM)
		expect(wall_age(state_at('i', START), START)).toBe(-1)
	})
})

describe('run_board_theme_rk800_wall.is_hit', () => {
	it('lands each hit for two ticks', () => {
		expect([1, 2, 3, 4, 5].map((age) => is_hit(age))).toStrictEqual([
			false,
			true,
			true,
			false,
			true,
		])
	})
})

describe('run_board_theme_rk800_wall.hits_passed', () => {
	it('counts the hits the wall has taken', () => {
		expect([0, 2, 14, LAST_HIT].map((age) => hits_passed(age))).toStrictEqual([0, 1, 4, 8])
	})
})

describe('run_board_theme_rk800_wall.grid_glyph', () => {
	it('crosses its columns and rows, empty between its lines', () => {
		expect([grid_glyph(0, 2), grid_glyph(0, 0), grid_glyph(1, 2), grid_glyph(1, 0)]).toStrictEqual([
			'┼',
			'│',
			'─',
			undefined,
		])
	})
})

describe('run_board_theme_rk800_wall.glitched', () => {
	it('keeps the word’s length and is the same at the same tick', () => {
		const word = 'DON’T'

		expect(code_points(glitched(word, 0, 1))).toHaveLength(code_points(word).length)
		expect(glitched(word, 0, 1)).toBe(glitched(word, 0, 1))
	})
})

describe('run_board_theme_rk800_wall.wall_wash', () => {
	it('is the night before the wall and after its drain, red while it builds', () => {
		const { layout } = HOST

		expect(wall_wash(layout, 0, WALL_FROM - 1)).toBe(RGB.night)
		expect(wall_wash(layout, 0, WALL_FROM + 10)).not.toBe(RGB.night)
		expect(wall_wash(layout, 0, PEAK + 40)).toBe(RGB.night)
	})
})

describe('run_board_theme_rk800_wall.build', () => {
	it('freezes the board and lays the order text over the area', () => {
		const age = 30
		const draw = draw_at('n', START + WALL_FROM + age)
		const { area_end, area_top } = HOST.layout
		const rows = Array.from({ length: area_end - area_top }, (_, index) =>
			row_text(draw.grid, area_top + 1 + index),
		)

		build(draw, age)

		const drawn = Array.from({ length: rows.length }, (_, index) =>
			row_text(draw.grid, area_top + 1 + index),
		)

		expect(drawn.join('\n')).toContain('MOVE')
		expect(draw.grid[0]).not.toStrictEqual(HOST.board[0])
	})
})
