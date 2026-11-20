import { describe, expect, it } from 'vitest'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_tick_draw } from './run-board-tick-draw'

const { THEME_DEFS } = run_board_theme_defs
const { has_strip } = run_board_tick_draw

const STRIP_ON = {
	...THEME_DEFS,
	wargames: { ...THEME_DEFS.wargames, live: { ...THEME_DEFS.wargames.live, strip: true } },
}

// joshuafolkken/kit#8398: the lamp strip (joshuafolkken/kit#8376) is off by default behind the theme's
// `live.strip`, the rules' launch codes left as they are.
describe('run_board_tick_draw.has_strip', () => {
	it('fills no strip in the wargames theme by default', () => {
		expect(has_strip({ theme: 'wargames' })).toBe(false)
	})

	it('fills the strip once the wargames definition switches it on', () => {
		expect(has_strip({ theme: 'wargames' }, STRIP_ON)).toBe(true)
	})

	it('fills no strip in a theme whose rules run no code, even switched on', () => {
		const matrix_on = {
			...THEME_DEFS,
			matrix: { ...THEME_DEFS.matrix, live: { ...THEME_DEFS.matrix.live, strip: true } },
		}

		expect(has_strip({ theme: 'matrix' }, matrix_on)).toBe(false)
	})

	it('fills no strip with no theme', () => {
		expect(has_strip({ theme: undefined }, STRIP_ON)).toBe(false)
	})
})
