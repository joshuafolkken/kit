import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { run_board_header_defcon } from './run-board-header-defcon'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_sound_click } from './run-board-sound-click'
import { run_board_sound_typing } from './run-board-sound-typing'
import { run_board_theme } from './run-board-theme'
import {
	run_board_theme_defs,
	type LiveDefinition,
	type ThemeDefinition,
} from './run-board-theme-defs'

// joshuafolkken/kit#8349: each theme's look is one row of a table, and the theme names the CLI and the
// worker accept are its keys — a row added is a theme accepted.

const { THEMES, THEME_DEFS, names_of } = run_board_theme_defs
const PHOSPHOR_RGB = '62;236;225'
const IDLE_RGB = '31;118;113'
const OFF_LIVE: LiveDefinition = {
	sweep: false,
	drop: false,
	types_rows: false,
	trill: false,
	codes: false,
	strip: false,
	decode: false,
	rain: false,
}
// joshuafolkken/kit#8356: the matrix board's new rows decode and its panel's cells run the idle rain;
// its typing sounds the key click (joshuafolkken/kit#8365); a drop falls down it every second in place
// of the sweep (joshuafolkken/kit#8367).
const MATRIX_LIVE: LiveDefinition = {
	...OFF_LIVE,
	types_rows: true,
	trill: true,
	decode: true,
	rain: true,
	drop: true,
}
const AMBER: ThemeDefinition = {
	name: 'josh-amber',
	capitals: true,
	paint: { rgb: '255;176;0', named: 'yellow' },
	rule: THEME_DEFS.wargames.rule,
	idle: THEME_DEFS.wargames.idle,
	intro: { line: 'READY', letter_ms: 1, hold_ms: 1 },
	alert: run_board_header_defcon.field_of,
	lamps: false,
	spinner: '|',
	live: OFF_LIVE,
	typing: run_board_sound_typing.teletype_wav,
}
const WIDER = { ...THEME_DEFS, amber: AMBER }

describe('run_board_theme_defs.live_of sweep', () => {
	it('enables the sweep only in the wargames definition', () => {
		expect(run_board_theme_defs.live_of('wargames').sweep).toBe(true)
		expect(run_board_theme_defs.live_of('matrix').sweep).toBe(false)
		expect(run_board_theme_defs.live_of(undefined).sweep).toBe(false)
		expect(run_board_theme_defs.live_of('wargames', {}).sweep).toBe(false)
	})
})

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
			name: 'josh-wopr',
			capitals: true,
			paint: { rgb: PHOSPHOR_RGB, named: 'cyan' },
			// joshuafolkken/kit#8397: the rules in the idle tone's dim cyan.
			rule: {
				dash: { rgb: IDLE_RGB, named: 'dim' },
				text: { rgb: PHOSPHOR_RGB, named: 'cyan' },
			},
			idle: { rgb: IDLE_RGB, named: 'dim' },
			intro: { line: 'SHALL WE PLAY A GAME?', letter_ms: 50, hold_ms: 2000 },
			alert: run_board_header_defcon.field_of,
			lamps: true,
			spinner: '│╱─╲',
			live: { ...OFF_LIVE, sweep: true, types_rows: true, trill: true, codes: true },
			typing: run_board_sound_typing.teletype_wav,
		})
	})
})

// joshuafolkken/kit#8365: each row names the voice its typing loops.
describe('run_board_theme_defs.THEME_DEFS typing', () => {
	it('types wargames to the teletype trill and matrix to the key click', () => {
		expect(THEME_DEFS.wargames.typing).toBe(run_board_sound_typing.teletype_wav)
		expect(THEME_DEFS.matrix.typing).toBe(run_board_sound_click.typing_wav)
	})
})

// joshuafolkken/kit#8354: the matrix row — the green phosphor body and the TRACE gauge; its opening is
// the approved demo's (joshuafolkken/kit#8441).
describe('run_board_theme_defs.THEME_DEFS matrix', () => {
	it('draws the green body, the TRACE alert, the approved opening, decoded rows and the idle rain', () => {
		expect(THEME_DEFS.matrix).toStrictEqual({
			name: 'josh-trace',
			// joshuafolkken/kit#8609: the text and the opening as written, in mixed case.
			capitals: false,
			paint: { rgb: '0;215;60', named: 'green' },
			rule: { dash: run_board_header_trace.SHADES.dark, text: run_board_header_trace.SHADES.mid },
			idle: run_board_header_trace.SHADES.mid,
			intro: {
				line: 'Knock, knock, Josh.',
				letter_ms: 50,
				hold_ms: 1300,
				leads: {
					lines: ['Wake up, Josh...', 'The board has you...', 'Follow the white rabbit.'],
					hold_ms: 1100,
					gap_ms: 300,
					paint: { rgb: '0;255;65', named: 'green' },
				},
			},
			alert: run_board_header_trace.field_of,
			lamps: true,
			spinner: 'ｦｱｳｴｵｶｷｹｺｻ',
			live: MATRIX_LIVE,
			typing: run_board_sound_click.typing_wav,
		})
	})

	it('shares the TRACE palette and each theme idle color without copying paints', () => {
		expect(THEME_DEFS.matrix.rule.dash).toBe(run_board_header_trace.SHADES.dark)
		expect(THEME_DEFS.matrix.rule.text).toBe(run_board_header_trace.SHADES.mid)
		expect(THEME_DEFS.matrix.idle).toBe(THEME_DEFS.matrix.rule.text)
		expect(THEME_DEFS.wargames.rule.dash).toBe(THEME_DEFS.wargames.idle)
		expect(THEME_DEFS.wargames.rule.text).toBe(THEME_DEFS.wargames.paint)
	})
})
