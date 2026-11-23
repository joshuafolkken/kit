import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_theme_defs, type Theme } from './run-board-theme-defs'
import { run_board_tick_theme } from './run-board-tick-theme'

const { THEME_DEFS } = run_board_theme_defs
const { decoded_of, entry_of, has_drop, has_lamps, has_rain, has_rule_lamps, has_strip } =
	run_board_tick_theme
const THEME: Theme = 'wargames'
const MATRIX = { types_rows: true, theme: 'matrix', is_tty: true } as const
const WARGAMES = { ...MATRIX, theme: 'wargames' } as const
const ONCE = '--once, --chat and a pipe'
const EVERY = '--every'
const STRIP_ON = {
	...THEME_DEFS,
	wargames: { ...THEME_DEFS.wargames, live: { ...THEME_DEFS.wargames.live, strip: true } },
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_tick_theme.has_lamps', () => {
	it('draws lamps on a live board in a theme, on a terminal drawing color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_lamps({ types_rows: true, theme: THEME, is_tty: true })).toBe(true)
	})

	it.each([
		['no theme', { types_rows: undefined, theme: undefined, is_tty: true }],
		[EVERY, { types_rows: false, theme: THEME, is_tty: true }],
		[ONCE, { types_rows: true, theme: THEME, is_tty: false }],
	])('draws none with %s', (_, ports) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_lamps(ports)).toBe(false)
	})

	it('draws none on a terminal drawing no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(has_lamps({ types_rows: true, theme: THEME, is_tty: true })).toBe(false)
	})

	it('draws none in a theme whose definition draws no lamps', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const ports = { types_rows: true, theme: THEME, is_tty: true }

		expect(has_lamps(ports, { [THEME]: { lamps: false } })).toBe(false)
	})
})

// joshuafolkken/kit#8356: the matrix board draws its lamp panel as the idle rain.
describe('run_board_tick_theme.has_rain', () => {
	it('draws the matrix board’s lamp panel, as the idle rain, on a terminal drawing color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_lamps(MATRIX)).toBe(true)
		expect(has_rain(MATRIX)).toBe(true)
	})

	it('runs no rain in the wargames board’s panel', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_rain(WARGAMES)).toBe(false)
	})

	it.each([
		[ONCE, { ...MATRIX, is_tty: false }],
		[EVERY, { ...MATRIX, types_rows: false }],
	])('runs none with %s', (_, ports) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_rain(ports)).toBe(false)
	})

	it('runs none on a terminal drawing no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(has_rain(MATRIX)).toBe(false)
	})
})

// joshuafolkken/kit#8702: the usage rule's row carries the panel in wargames and matrix, not bttf.
describe('run_board_tick_theme.has_rule_lamps', () => {
	it.each([
		[WARGAMES, true],
		[MATRIX, true],
		[{ ...MATRIX, theme: 'bttf' } as const, false],
	])('lamps the rule in %o: %s', (ports, expected) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_rule_lamps(ports)).toBe(expected)
	})

	it('lamps none on a terminal drawing no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(has_rule_lamps(WARGAMES)).toBe(false)
	})
})

// joshuafolkken/kit#8398: the lamp strip (joshuafolkken/kit#8376) is off by default behind the theme's
// `live.strip`, the rules' launch codes left as they are.
describe('run_board_tick_theme.has_strip', () => {
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

describe('run_board_tick_theme.entry_of', () => {
	it('decodes the matrix board’s new rows on a terminal drawing color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(entry_of(MATRIX)).toBe('decode')
	})

	it('types the wargames board’s new rows', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(entry_of(WARGAMES)).toBe('type')
	})

	// joshuafolkken/kit#8683: bttf types its new rows as wargames does — one typing style for every theme.
	it('types the bttf board’s new rows', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(entry_of({ ...MATRIX, theme: 'bttf' })).toBe('type')
	})

	it.each([
		[ONCE, { ...MATRIX, is_tty: false }],
		[EVERY, { ...MATRIX, types_rows: false }],
	])('shows the matrix board’s rows at once with %s', (_, ports) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(entry_of(ports)).toBe('none')
	})

	it('shows the matrix board’s rows at once on a terminal drawing no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(entry_of(MATRIX)).toBe('none')
	})
})

const STRIP_CELL = { row: 4, column: 70, index: 0, count: 1 }
const RULE_CELL = { row: 5, column: 0 }

describe('run_board_tick_theme.decoded_of', () => {
	it('keeps the strip cells and the rules’ code once the wargames definition switches the strip on', () => {
		const drawn = { rules: [RULE_CELL], strips: [STRIP_CELL] }

		expect(decoded_of({ theme: 'wargames' }, drawn, STRIP_ON)).toStrictEqual(drawn)
	})

	it('keeps the rules’ code and drops the strip cells by default', () => {
		const drawn = { rules: [RULE_CELL], strips: [STRIP_CELL] }

		expect(decoded_of({ theme: 'wargames' }, drawn)).toStrictEqual({
			rules: [RULE_CELL],
			strips: [],
		})
	})
})

// joshuafolkken/kit#8367: a drop falls down the matrix board every second, on the lamps' gate.
describe('run_board_tick_theme.has_drop', () => {
	it('drops one down the live matrix board on a terminal drawing color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_drop(MATRIX)).toBe(true)
	})

	it.each([
		['the wargames board', WARGAMES],
		['a board in no theme', { ...MATRIX, theme: undefined }],
		[ONCE, { ...MATRIX, is_tty: false }],
		[EVERY, { ...MATRIX, types_rows: false }],
	])('drops none on %s', (_, ports) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_drop(ports)).toBe(false)
	})

	it('drops none on a terminal drawing no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(has_drop(MATRIX)).toBe(false)
	})
})
