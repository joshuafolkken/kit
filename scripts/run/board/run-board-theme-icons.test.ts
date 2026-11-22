import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Icons } from './run-board-icons'
import { run_board_labels } from './run-board-labels'
import { run_board_theme, type Theme } from './run-board-theme'
import { run_board_theme_tones } from './run-board-theme-tones'

// joshuafolkken/kit#8505: each icons a board in a theme or in none draws, unset taking the theme's own.

const [DOT = ''] = run_board_labels.SPINNER_FRAMES
const LINE = `🔄 run ── 🔗 ${DOT}`
const THEMED_SHAPES = '>> RUN -- <- │'

interface Combination {
	theme: Theme | undefined
	icons: Icons | undefined
	drawn: string
}

const COMBINATIONS: ReadonlyArray<Combination> = [
	{ theme: undefined, icons: undefined, drawn: LINE },
	{ theme: undefined, icons: 'emoji', drawn: LINE },
	{ theme: undefined, icons: 'letters', drawn: `RN run ── LK ${DOT}` },
	{ theme: undefined, icons: 'shapes', drawn: `>> run ── <- ${DOT}` },
	{ theme: 'wargames', icons: undefined, drawn: THEMED_SHAPES },
	{ theme: 'wargames', icons: 'emoji', drawn: '🔄 RUN -- 🔗 │' },
	{ theme: 'wargames', icons: 'letters', drawn: 'RN RUN -- LK │' },
	{ theme: 'wargames', icons: 'shapes', drawn: THEMED_SHAPES },
]

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_theme.restyle in its icons', () => {
	it.each(COMBINATIONS)('draws $icons in $theme as `$drawn`', ({ theme, icons, drawn }) => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(run_board_theme.restyle(theme, LINE, icons)).toBe(drawn)
	})

	it('colors the letters by their tone and nothing else with no theme', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const toned = run_board_theme_tones.toned('running', 'RN')

		expect(run_board_theme.restyle(undefined, '🔄 run', 'letters')).toBe(`${toned} run`)
	})

	it('draws a line again in the icons asked after another icons drew it', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		for (const icons of ['letters', 'shapes', 'letters'] as const) {
			expect(run_board_theme.restyle('wargames', '🔄', icons)).toBe(
				icons === 'letters' ? 'RN' : '>>',
			)
		}
	})
})
