import { describe, expect, it } from 'vitest'
import { run_board_theme_skynet_data } from './run-board-theme-skynet-data'
import { run_board_theme_skynet_fixture } from './run-board-theme-skynet-fixture'
import { run_board_theme_skynet_hud } from './run-board-theme-skynet-hud'

// joshuafolkken/kit#8917: the TERMINATOR theme's panel HUD, reticles and sight.

const { blink_ink, data_reading, idle_reticle, match_of, mode_of, panel_hud, reticle_lane, sight } =
	run_board_theme_skynet_hud
const { INKS } = run_board_theme_skynet_data
const { HOST, draw_at, row_text } = run_board_theme_skynet_fixture

describe('run_board_theme_skynet_hud', () => {
	it('lights a reticle four ticks in six', () => {
		expect(blink_ink(3)).toBe(INKS.INK)
		expect(blink_ink(4)).toBe(INKS.DIM_RED)
	})

	it('reads a label and four digits', () => {
		expect(data_reading(5, 1, 60)).toMatch(/^AZM \d{4}$/u)
	})

	it('is locked at a full match while nothing types', () => {
		const { s } = draw_at('i', 30)

		expect(mode_of(s, 30)).toBe('LOCKED')
		expect(match_of(s, 30)).toBe(100)
	})

	it('caps the match below a hundred while typing', () => {
		const { s } = draw_at('n', 85)

		expect(s.busy).toBe(true)
		expect(mode_of(s, 85)).not.toBe('LOCKED')
		expect(match_of(s, 85)).toBe(99.9)
	})
})

describe('run_board_theme_skynet_hud drawing', () => {
	it('brackets the lane the idle reticle hops to', () => {
		const draw = draw_at('i', 0)
		const { issue_x, lane_rows } = HOST.layout
		const y = lane_rows[0] ?? 0

		idle_reticle(draw)

		expect(row_text(draw.grid, y).slice(issue_x - 1, issue_x + 5)).toBe(
			`[${reticle_lane(HOST.api, 0)}]`,
		)
	})

	it('rescans on the panel while idle', () => {
		const draw = draw_at('i', 0)

		panel_hud(draw, '#123')

		expect(row_text(draw.grid, 5)).toContain('ANALYSIS: SCANNING…')
		expect(row_text(draw.grid, 5)).toContain('ID #123')
	})

	it('draws the sight with a solid core while idle', () => {
		const draw = draw_at('i', 0)

		sight(draw, { y: 4, x: 2 })

		expect(row_text(draw.grid, 5).slice(2, 13)).toBe('──   ╋   ──')
	})
})
