import { describe, expect, it } from 'vitest'
import { run_board_theme_rk800_fixture } from './run-board-theme-rk800-fixture'
import { run_board_theme_rk800_parts } from './run-board-theme-rk800-parts'
import { run_board_theme_rk800_status } from './run-board-theme-rk800-status'

// joshuafolkken/kit#9096: the rk800 theme's idle panel's STATUS page — the LED ring and the
// probability readout.

const { is_notice, status_page } = run_board_theme_rk800_status
const { stage_of } = run_board_theme_rk800_parts
const { draw_at, panel_text } = run_board_theme_rk800_fixture
const CALM = { stress: 10, is_alarm: false, has_mark: false }
const ALARM = { stress: 50, is_alarm: true, has_mark: false }
const SETTLED_AGE = 200

describe('run_board_theme_rk800_status.is_notice', () => {
	it('is a notice while its wall builds or once it has peaked', () => {
		const looks = [CALM, ALARM, { ...CALM, has_mark: true }]

		expect(looks.map((look) => is_notice(look))).toStrictEqual([false, true, true])
	})
})

describe('run_board_theme_rk800_status.status_page', () => {
	it('reads a calm board as stable, its labels and ring in place', () => {
		const draw = draw_at('i', 0)

		status_page(stage_of(draw), 0, SETTLED_AGE, CALM)

		expect(panel_text(draw.grid, 2)).toMatch(/^ ╭───╮/u)
		expect(panel_text(draw.grid, 3)).toContain('PROBABILITY')
		expect(panel_text(draw.grid, 4)).toContain('OF SUCCESS')
		expect(panel_text(draw.grid, 5)).toContain('STATUS STABLE')
	})

	it('reads a building wall as deviant and destabilizing, whole at once', () => {
		const draw = draw_at('i', 0)

		status_page(stage_of(draw), 0, 0, ALARM)

		expect(panel_text(draw.grid, 2)).toContain('∨')
		expect(panel_text(draw.grid, 5)).toContain('DEVIANT DESTABILIZING')
	})

	it('draws the number on one row on a six-row panel', () => {
		const draw = draw_at('i', 0)
		const stage = stage_of(draw)
		const short = { ...stage, body: stage.body - 1 }

		status_page(short, 0, 0, ALARM)
		expect(panel_text(draw.grid, 2)).toContain('50%')
	})
})
