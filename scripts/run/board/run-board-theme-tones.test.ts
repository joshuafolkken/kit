import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_theme_tones } from './run-board-theme-tones'

// joshuafolkken/kit#8150: the colors of a themed board's icon text.

const { TONE_PAINTS, toned } = run_board_theme_tones
const ESCAPE = '\u{1B}'
const DEFAULT_FOREGROUND = `${ESCAPE}[39m`
const BOLD = `${ESCAPE}[1m`
const BOLD_OFF = `${ESCAPE}[22m`
const TEXT = 'XX'
const IDLE_RGB = '31;118;113'

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

describe('run_board_theme_tones.toned idle', () => {
	// joshuafolkken/kit#8917: a themed board's base draws idle in the base look's idle; the tones' own
	// dim is the default.
	it.each([
		{ idle: 'base', force: '3', expected: rgb('0;150;36') },
		{ idle: 'default', force: '3', expected: rgb(IDLE_RGB) },
		{ idle: 'base', force: '1', expected: `${ESCAPE}[32m${TEXT}${DEFAULT_FOREGROUND}` },
		{ idle: 'default', force: '1', expected: `${ESCAPE}[2m${TEXT}${BOLD_OFF}` },
	] as const)('draws the $idle idle at depth $force', ({ idle, force, expected }) => {
		vi.stubEnv('FORCE_COLOR', force)
		const paint = idle === 'base' ? run_board_theme_defs.BASE_LOOK.idle : undefined

		expect(toned('idle', TEXT, paint)).toBe(expected)
	})
})

describe('run_board_theme_tones.toned', () => {
	it.each([
		{ tone: 'alert', expected: rgb('255;69;58') },
		{ tone: 'caution', expected: rgb('255;214;10') },
		{ tone: 'human', expected: rgb('255;95;215') },
		{ tone: 'done', expected: rgb('48;209;88') },
		{ tone: 'running', expected: `${BOLD}${rgb('255;255;255')}${BOLD_OFF}` },
		{ tone: 'idle', expected: rgb(IDLE_RGB) },
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
