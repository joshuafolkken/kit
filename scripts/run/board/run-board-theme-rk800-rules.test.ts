import { describe, expect, it } from 'vitest'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_fixture } from './run-board-theme-rk800-fixture'
import { run_board_theme_rk800_parts } from './run-board-theme-rk800-parts'
import { run_board_theme_rk800_rules } from './run-board-theme-rk800-rules'

// joshuafolkken/kit#9096: the rk800 theme's rules — the analysis bar over them, and their parts'
// inks on the normal display.

const { is_rule_row, rule_bar, rule_inks, rule_rows } = run_board_theme_rk800_rules
const { RGB } = run_board_theme_rk800_data
const { bold, ink } = run_board_theme_rk800_parts
const { HOST, draw_at } = run_board_theme_rk800_fixture
const RULE_ROWS = [4, 8, 13, 18, 21, 30, 46, 56]
const THROUGHPUT = 4
const LANES = 13
// The PROGRESS line types from tick 10.
const TYPING = 30

function style_at(grid: Grid, y: number, x: number): string | undefined {
	return grid[y]?.[x]?.[1]
}

describe('run_board_theme_rk800_rules.is_rule_row', () => {
	it('tells a section’s rule from a row of data', () => {
		expect([is_rule_row(HOST.board, THROUGHPUT), is_rule_row(HOST.board, 5)]).toStrictEqual([
			true,
			false,
		])
	})
})

describe('run_board_theme_rk800_rules.rule_rows', () => {
	it('finds every section’s rule on the board', () => {
		expect(rule_rows(draw_at('i', 0))).toStrictEqual(RULE_ROWS)
	})
})

describe('run_board_theme_rk800_rules.rule_bar', () => {
	it('lights the rules red from the left while the line types', () => {
		const draw = draw_at('p', TYPING)

		rule_bar(draw)
		expect(style_at(draw.grid, THROUGHPUT, 0)).toBe(bold(RGB.red))
		expect(style_at(draw.grid, THROUGHPUT, HOST.layout.edge - 1)).toBe(ink(RGB.track))
		expect(draw.grid[5]).toStrictEqual(HOST.board[5])
	})

	it('leaves the rules alone while idle', () => {
		const draw = draw_at('i', TYPING)

		rule_bar(draw)
		expect(draw.grid[THROUGHPUT]).toStrictEqual(HOST.board[THROUGHPUT])
	})
})

describe('run_board_theme_rk800_rules.rule_inks', () => {
	it('inks the mark, the heading, a count and a column’s label apart', () => {
		const draw = draw_at('i', 0)
		const label_x = HOST.board[THROUGHPUT]?.findIndex(([ch]) => ch === '/') ?? -1

		rule_inks(draw)
		expect(style_at(draw.grid, THROUGHPUT, 0)).toBe(ink(RGB.blue))
		expect(style_at(draw.grid, THROUGHPUT, 6)).toBe(bold(RGB.white))
		expect(style_at(draw.grid, LANES, 12)).toBe(ink(RGB.cyan))
		expect(style_at(draw.grid, THROUGHPUT, label_x)).not.toBe(bold(RGB.white))
	})
})
