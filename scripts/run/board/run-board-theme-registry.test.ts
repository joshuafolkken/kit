import { describe, expect, it } from 'vitest'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_theme_registry } from './run-board-theme-registry'
import { run_board_theme_run } from './run-board-theme-run'
import { run_board_theme_sound } from './run-board-theme-sound'

// joshuafolkken/kit#8917: the theme host's works by their canonical theme value, drawn only in 24-bit
// color (Issue 4-3).

const { factory_of, run_of } = run_board_theme_registry
const { THEMES } = run_board_theme_defs
const TRUE_COLOR = 24
const NAMED_COLOR = 8

describe('run_board_theme_registry.factory_of', () => {
	it('has a work for every theme value but none', () => {
		for (const value of run_board_theme_run.THEME_VALUES) {
			expect(factory_of(value) !== undefined).toBe(value !== '')
		}
	})
})

describe('run_board_theme_registry.run_of', () => {
	it.each(THEMES)('draws %s as its own work on a terminal of 24-bit color', (theme) => {
		expect(run_of(theme, TRUE_COLOR)?.value).toBe(theme)
	})

	it.each(THEMES)('runs no %s theme without 24-bit color', (theme) => {
		expect(run_of(theme, NAMED_COLOR)).toBeUndefined()
	})

	// Issue 4-4: `/` reaches demo mode from a board launched in no theme, or saved as none.
	it('runs one showing none in no theme, with no opening to play', () => {
		const run = run_of(undefined, TRUE_COLOR)

		expect(run?.value).toBe('')
		expect(run?.part).toBeUndefined()
		expect(run && run_board_theme_run.is_drawn(run)).toBe(false)
	})

	it('runs none in no theme without 24-bit color', () => {
		expect(run_of(undefined, NAMED_COLOR)).toBeUndefined()
	})

	it('sounds the opening of the theme shown, not the one launched (Issue 4-4)', () => {
		const run = run_of('wopr', TRUE_COLOR)

		expect(run?.opening_sound('wopr').typed_ms).toBeGreaterThan(0)
		expect(run?.opening_sound('codec')).toStrictEqual(
			run_board_theme_sound.opening_sound_of('codec'),
		)
		expect(run?.opening_sound('')).toBe(run_board_theme_sound.SILENT)
	})
})
