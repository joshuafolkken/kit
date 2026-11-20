import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { run_board_header_defcon } from './run-board-header-defcon'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_theme } from './run-board-theme'
import { run_board_theme_defs, type ThemeDefinition } from './run-board-theme-defs'

// joshuafolkken/kit#8349: each theme's look is one row of a table, and the theme names the CLI and the
// worker accept are its keys — a row added is a theme accepted.

const { THEMES, THEME_DEFS, names_of } = run_board_theme_defs
const AMBER: ThemeDefinition = {
	paint: { rgb: '255;176;0', named: 'yellow' },
	intro: { line: 'READY', letter_ms: 1, hold_ms: 1 },
	alert: run_board_header_defcon.field_of,
	lamps: false,
	live: { types_rows: false, trill: false, codes: false },
}
const WIDER = { ...THEME_DEFS, amber: AMBER }

describe('run_board_theme_defs.THEMES', () => {
	it('names every row of the table, in its order', () => {
		expect(THEMES).toStrictEqual(Object.keys(THEME_DEFS))
	})

	it('is the list the CLI and the worker check a theme name against', () => {
		expect(run_board_theme.THEMES).toBe(THEMES)
	})
})

describe('run_board_theme_defs.names_of', () => {
	it('names a row added to the table', () => {
		expect(names_of(WIDER)).toStrictEqual(['wargames', 'matrix', 'amber'])
	})

	it('gives a list the worker check accepts the added theme from', () => {
		expect(z.enum(names_of(WIDER)).parse('amber')).toBe('amber')
	})

	it('refuses a table with no theme', () => {
		expect(() => names_of({})).toThrow('no theme')
	})
})

describe('run_board_theme_defs.THEME_DEFS wargames', () => {
	it('keeps the phosphor cyan and the opening line the board drew before the table', () => {
		expect(THEME_DEFS.wargames).toStrictEqual({
			paint: { rgb: '62;236;225', named: 'cyan' },
			// joshuafolkken/kit#8397: the rules in the idle tone's dim cyan.
			rule: { rgb: '31;118;113', named: 'dim' },
			intro: { line: 'SHALL WE PLAY A GAME?', letter_ms: 50, hold_ms: 2000 },
			alert: run_board_header_defcon.field_of,
			lamps: true,
			live: { types_rows: true, trill: true, codes: true },
		})
	})
})

// joshuafolkken/kit#8354: the matrix row — the green phosphor body and the TRACE gauge, no effects yet.
describe('run_board_theme_defs.THEME_DEFS matrix', () => {
	it('draws the green body and the TRACE alert, with no opening line, lamps or live effects', () => {
		expect(THEME_DEFS.matrix).toStrictEqual({
			paint: { rgb: '0;215;60', named: 'green' },
			intro: { line: '', letter_ms: 0, hold_ms: 0 },
			alert: run_board_header_trace.field_of,
			lamps: false,
			live: { types_rows: false, trill: false, codes: false },
		})
	})
})
