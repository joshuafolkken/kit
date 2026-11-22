import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_theme } from './run-board-theme'
import { run_board_theme_tones } from './run-board-theme-tones'

// joshuafolkken/kit#8354: the matrix theme — its green phosphor body and the colors it keeps.

const ESCAPE = '\u{1B}'
const DEFAULT_FOREGROUND = `${ESCAPE}[39m`
const RED = `${ESCAPE}[31m`
const RGB_MATRIX = `${ESCAPE}[38;2;0;215;60m`
const NAMED_GREEN = `${ESCAPE}[32m`
const LINK_OPEN = `${ESCAPE}]8;;https://github.com/joshuafolkken/kit/issues/1\u{7}`
const LINK_CLOSE = `${ESCAPE}]8;;\u{7}`
const LINE = `🚨 ${RED}fix${DEFAULT_FOREGROUND} ⚠️ the ${LINK_OPEN}board${LINK_CLOSE} → 🔨 ⠋`

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_theme.restyle matrix', () => {
	it('opens every line in the 24-bit green phosphor body', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(run_board_theme.restyle('matrix', 'A')).toBe(`${RGB_MATRIX}A${DEFAULT_FOREGROUND}`)
	})

	it('draws the palette green where stdout has no 24-bit color', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(run_board_theme.restyle('matrix', 'A')).toBe(`${NAMED_GREEN}A${DEFAULT_FOREGROUND}`)
	})

	it('keeps the fault red and the caution amber, resuming the green after each', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const fault = run_board_theme_tones.toned('alert', 'FL')
		const caution = run_board_theme_tones.toned('caution', 'JG')
		const resumed = [fault, caution].map((text) => text.split(DEFAULT_FOREGROUND).join(RGB_MATRIX))

		expect(run_board_theme.restyle('matrix', `${fault} ${caution}`)).toBe(
			`${RGB_MATRIX}${resumed.join(' ')}${DEFAULT_FOREGROUND}`,
		)
		expect(fault).toContain('255;69;58')
		expect(caution).toContain('255;214;10')
	})
})

// joshuafolkken/kit#8609: matrix draws the text as written — only wargames draws capitals — and its
// letter icons in the capitals the glyph table gives them.
describe('run_board_theme.restyle matrix case', () => {
	it('draws a line with lower-case letters in the case it is written', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		const row = '  #1 fix board in Mixed Case'

		expect(run_board_theme.restyle('matrix', row)).toBe(row)
	})

	it('draws the same line in capitals in wargames', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(run_board_theme.restyle('wargames', '  #1 fix board')).toBe('  #1 FIX BOARD')
	})

	it('draws each letter icon in capitals beside the text as written, with --icons letters', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(run_board_theme.restyle('matrix', LINE, 'letters')).toBe(
			`P1 ${RED}fix${DEFAULT_FOREGROUND} !  the ${LINK_OPEN}board${LINK_CLOSE} > BD ｦ`,
		)
	})
})
