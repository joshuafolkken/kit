import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_fixture } from './run-board-theme-deviant-fixture'
import { run_board_theme_deviant_header } from './run-board-theme-deviant-header'

// joshuafolkken/kit#9096: the deviant theme's NOTICE in the header's borrowed blocks — the order and
// its two choices, the gauges, the probability.

const { choice_share, close, odds_of, open } = run_board_theme_deviant_header
const { HOST, draw_at, row_text } = run_board_theme_deviant_fixture
// The demo's NOTICE starts typing on tick 10; a choice's lines, IGNORE over OBEY.
const NOTICE_START = 10
const IGNORE = 0
const OBEY = 1
const WALLED_AGE = 30
const PEAK_AGE = 80

describe('run_board_theme_deviant_header.choice_share', () => {
	it('lights OBEY once the list shows, then fades the plate up to IGNORE', () => {
		expect([0, 8, 14].map((age) => choice_share(OBEY, age))).toStrictEqual([0, 1, 0])
		expect([0, 8, 14].map((age) => choice_share(IGNORE, age))).toStrictEqual([0, 0, 1])
	})
})

describe('run_board_theme_deviant_header.odds_of', () => {
	it('falls through the wall’s build and rises from the peak', () => {
		expect(odds_of(0)).toBe(92)
		expect(odds_of(PEAK_AGE - 1)).toBe(9)
		expect(odds_of(PEAK_AGE)).toBe(8)
		expect(odds_of(PEAK_AGE + 60)).toBe(99)
	})
})

describe('run_board_theme_deviant_header.open', () => {
	it('keeps the header’s rows and empties the left block', () => {
		const draw = draw_at('n', NOTICE_START)
		const before = [0, 1, 2].map((y) => row_text(draw.grid, y))
		const kept = open(draw, 0)

		expect(kept.map((row) => row.map(([ch]) => ch).join(''))).toStrictEqual(before)
		expect(row_text(draw.grid, 0).slice(0, HOST.layout.head_left.w).trim()).toBe('')
	})
})

describe('run_board_theme_deviant_header.close', () => {
	it('draws the order, the gauges and the falling probability once the wall starts', () => {
		const draw = draw_at('n', NOTICE_START + WALLED_AGE)
		const { head_right, head_top } = HOST.layout

		close(draw, WALLED_AGE, open(draw, WALLED_AGE))

		const top = row_text(draw.grid, 0)

		expect(top.slice(0, head_top.x)).toMatch(/MOVE/u)
		expect(top.slice(head_top.x, head_top.x + head_top.w)).toContain('CPU')
		expect(top.slice(head_right.x)).toContain(`∨ ${String(odds_of(WALLED_AGE))}%`)
	})

	it('gives the blocks back to the board once the notice has faded', () => {
		const age = PEAK_AGE + 90
		const draw = draw_at('n', NOTICE_START + age)
		const before = row_text(draw.grid, 0)

		close(draw, age, open(draw, age))
		expect(row_text(draw.grid, 0)).toBe(before)
	})
})
