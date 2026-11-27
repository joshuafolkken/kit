import { describe, expect, it } from 'vitest'
import { run_board_theme_rk800_fixture } from './run-board-theme-rk800-fixture'
import { run_board_theme_rk800_link } from './run-board-theme-rk800-link'

// joshuafolkken/kit#9096: the rk800 theme's idle link line from the panel's selected plate.

const { lane_path, link, rule_path } = run_board_theme_rk800_link
const { HOST, draw_at, fresh_grid, row_text } = run_board_theme_rk800_fixture
const { area_end, px } = HOST.layout
// The choice list's cursor sits on CONTINUE, the panel's row 7, once its entrance is over.
const SETTLED = 30
const CURSOR_ROW = 7
const RULE_ROW = 8
const LANE_ROW = 14

describe('run_board_theme_rk800_link.rule_path', () => {
	it('runs straight across when the rule is on the cursor’s row', () => {
		expect(rule_path(HOST.layout, RULE_ROW, RULE_ROW).map(({ ch }) => ch)).toStrictEqual([
			'─',
			'─',
			'─',
		])
	})

	it('turns down the panel’s side to a lower rule', () => {
		const steps = rule_path(HOST.layout, CURSOR_ROW, RULE_ROW + 1)

		expect(steps.map(({ ch }) => ch).join('')).toBe('─┌│┘─')
		expect(steps.at(-1)?.at).toStrictEqual({ y: RULE_ROW + 1, x: px - 2 })
	})

	it('turns up to a higher rule', () => {
		expect(
			rule_path(HOST.layout, RULE_ROW, CURSOR_ROW - 1)
				.map(({ ch }) => ch)
				.join(''),
		).toBe('─└│┐─')
	})
})

describe('run_board_theme_rk800_link.lane_path', () => {
	it('runs down the panel’s side, under the area and down the left margin to the lane', () => {
		const steps = lane_path(HOST.layout, { y: CURSOR_ROW, x: px + 1 }, LANE_ROW)
		const corners = steps.filter(({ ch }) => ch !== '─' && ch !== '│')

		expect(corners.map(({ ch, at }) => [ch, at.y, at.x])).toStrictEqual([
			['┌', CURSOR_ROW, px - 1],
			['┘', area_end + 1, px - 1],
			['┌', area_end + 1, 0],
			['└', LANE_ROW, 0],
		])
		expect(steps.at(-1)).toStrictEqual({ at: { y: LANE_ROW, x: 1 }, ch: '─' })
	})
})

describe('run_board_theme_rk800_link.link', () => {
	it('lays the line from the choice list’s cursor out of the panel', () => {
		const draw = draw_at('i', SETTLED)

		link(draw)
		expect(row_text(draw.grid, CURSOR_ROW).slice(px - 1, px + 1)).toBe('┌─')
	})

	it('lays nothing while the page’s entrance runs', () => {
		const draw = draw_at('i', 0)

		link(draw)
		expect(draw.grid).toStrictEqual(fresh_grid())
	})
})
