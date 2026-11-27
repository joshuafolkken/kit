import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_fixture } from './run-board-theme-deviant-fixture'
import { run_board_theme_deviant_panel, type PanelLook } from './run-board-theme-deviant-panel'

// joshuafolkken/kit#9096: the deviant theme's idle panel — the model line, the page whose turn it
// is, the chevrons and the date card.

const { idle } = run_board_theme_deviant_panel
const { MODEL } = run_board_theme_deviant_data
const { draw_at, panel_text } = run_board_theme_deviant_fixture
const AT_REST: PanelLook = { has_mark: false, is_alarm: false, hits: 0, stress: 10 }
const SETTLED = 30
const CHAPTERS_PAGE = 330
const RIGHT = 44
const BOTTOM = 6

describe('run_board_theme_deviant_panel.idle', () => {
	it('draws the model line, the choice list, the date card and the brand', () => {
		const draw = draw_at('i', SETTLED)

		idle(draw, AT_REST)

		expect(panel_text(draw.grid, 0)).toContain('▌ RK800 ANDROID')
		expect(panel_text(draw.grid, 2)).toContain('△ CONTINUE')
		expect(panel_text(draw.grid, 5)).toContain('✕ STAND BY')
		expect(panel_text(draw.grid, BOTTOM)).toMatch(/^ NOV 24TH {2}PM 07:10 /u)
		expect(panel_text(draw.grid, BOTTOM).trimEnd()).toMatch(new RegExp(`${MODEL.brand}$`, 'u'))
	})

	it('turns to the chapters page in its turn', () => {
		const draw = draw_at('i', CHAPTERS_PAGE)

		idle(draw, AT_REST)
		expect(panel_text(draw.grid, 1)).toContain('C H A P T E R S')
	})

	it('shows the status page, the mark and a chevron a hit through a NOTICE', () => {
		const draw = draw_at('i', SETTLED)
		const look = { has_mark: true, is_alarm: false, hits: 3, stress: 50 }

		idle(draw, look)

		expect(panel_text(draw.grid, 0)).toContain('SOFTWARE INSTABILITY ▲')
		expect(panel_text(draw.grid, 5)).toContain('DEVIANT STABILIZING')
		expect([3, 4, 5].map((y) => panel_text(draw.grid, y).charAt(RIGHT))).toStrictEqual([
			'▲',
			'▲',
			'▲',
		])
	})
})
