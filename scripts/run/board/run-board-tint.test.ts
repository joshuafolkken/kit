import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_tint } from './run-board-tint'

// A color laid over text a render module gave no color (`run-board-theme.ts`): its escape as stdout
// draws it, and a color the line gives kept, the tint resumed after it.

const ESCAPE = '\u{1B}'
const GREEN = { rgb: '0;215;60', named: 'green' } as const
const RGB_GREEN = `${ESCAPE}[38;2;0;215;60m`
const RED = `${ESCAPE}[31m`
const DEFAULT_FOREGROUND = `${ESCAPE}[39m`
const RESET = `${ESCAPE}[0m`

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_tint.open_of', () => {
	it('opens a shade in 24-bit color, its palette color without, nothing with no color', () => {
		const opened = ['3', '1', '0'].map((force) => {
			vi.stubEnv('FORCE_COLOR', force)

			return run_board_tint.open_of(GREEN)
		})

		expect(opened).toStrictEqual([RGB_GREEN, `${ESCAPE}[32m`, ''])
	})
})

describe('run_board_tint.lit', () => {
	it('lays the tint over the line and ends it on the default foreground', () => {
		expect(run_board_tint.lit(RGB_GREEN, 'A')).toBe(`${RGB_GREEN}A${DEFAULT_FOREGROUND}`)
	})

	it('keeps a color the line gives and resumes the tint after it and after a reset', () => {
		const line = `A ${RED}B${DEFAULT_FOREGROUND} C ${RED}D${RESET} E`

		expect(run_board_tint.lit(RGB_GREEN, line)).toBe(
			`${RGB_GREEN}A ${RED}B${RGB_GREEN} C ${RED}D${RESET}${RGB_GREEN} E${DEFAULT_FOREGROUND}`,
		)
	})

	it('leaves the line as it is with no tint or no text', () => {
		expect(run_board_tint.lit('', 'A')).toBe('A')
		expect(run_board_tint.lit(RGB_GREEN, '')).toBe('')
	})
})
