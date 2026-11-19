import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_theme_tones } from './run-board-theme-tones'

// joshuafolkken/kit#8150: the colors of the WarGames theme's icon text.

const { TONE_PAINTS, toned } = run_board_theme_tones
const ESCAPE = '\u{1B}'
const DEFAULT_FOREGROUND = `${ESCAPE}[39m`
const BOLD = `${ESCAPE}[1m`
const BOLD_OFF = `${ESCAPE}[22m`
const TEXT = 'XX'

function rgb(value: string): string {
	return `${ESCAPE}[38;2;${value}m${TEXT}${DEFAULT_FOREGROUND}`
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_theme_tones.TONE_PAINTS', () => {
	it('shares the red, yellow and green of the machine gauges', () => {
		const { GAUGE_SHADES } = run_board_labels

		expect(TONE_PAINTS.alert).toBe(GAUGE_SHADES.red)
		expect(TONE_PAINTS.caution).toBe(GAUGE_SHADES.yellow)
		expect(TONE_PAINTS.done).toBe(GAUGE_SHADES.normal)
	})
})

describe('run_board_theme_tones.toned', () => {
	it.each([
		{ tone: 'alert', expected: rgb('255;69;58') },
		{ tone: 'caution', expected: rgb('255;214;10') },
		{ tone: 'human', expected: rgb('255;95;215') },
		{ tone: 'done', expected: rgb('48;209;88') },
		{ tone: 'running', expected: `${BOLD}${rgb('255;255;255')}${BOLD_OFF}` },
		{ tone: 'idle', expected: rgb('31;118;113') },
		{ tone: 'info', expected: TEXT },
	] as const)(
		'draws the $tone tone in 24-bit color, ending on the default foreground',
		({ tone, expected }) => {
			vi.stubEnv('FORCE_COLOR', '3')

			expect(toned(tone, TEXT)).toBe(expected)
		},
	)

	it.each(run_board_theme_tones.TONES)(
		'draws %s with no escape where stdout draws no color',
		(tone) => {
			vi.stubEnv('FORCE_COLOR', '0')

			expect(toned(tone, TEXT)).toBe(TEXT)
		},
	)
})
