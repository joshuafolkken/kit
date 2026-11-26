import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_sound_click } from './run-board-sound-click'
import { run_board_sound_codec } from './run-board-sound-codec'
import { run_board_sound_enter } from './run-board-sound-enter'
import { run_board_sound_keypad } from './run-board-sound-keypad'
import { run_board_sound_nixie } from './run-board-sound-nixie'
import { run_board_sound_palettes_film } from './run-board-sound-palettes-film'
import { run_board_sound_palettes_more } from './run-board-sound-palettes-more'
import { run_board_sound_skynet } from './run-board-sound-skynet'
import { run_board_sound_typing } from './run-board-sound-typing'
import { run_board_theme } from './run-board-theme'
import { run_board_theme_defs, type ThemeDefinition } from './run-board-theme-defs'
import { run_board_theme_magi_data } from './run-board-theme-magi-data'

// joshuafolkken/kit#8349: each theme is one row of a table, and the theme values the CLI and the worker
// accept are its keys — a row added is a theme accepted. joshuafolkken/kit#8917: the values are the
// boards' names after `josh-`, the works' titles their aliases, and the base every theme draws over is
// one palette.

const { BASE_LOOK, THEMES, THEME_ALIASES, THEME_DEFS, names_of } = run_board_theme_defs
const AMBER: ThemeDefinition = {
	name: 'josh-amber',
	intro: { line: 'READY', letter_ms: 1 },
	typing: run_board_sound_typing.teletype_wav,
	typed_end: THEME_DEFS.wopr.typed_end,
	score: THEME_DEFS.wopr.score,
}
const WIDER = { ...THEME_DEFS, amber: AMBER }
// joshuafolkken/kit#8917: the four works the demo added each type and end in their own voice.
const OWN_VOICES = [
	['codec', run_board_sound_codec],
	['nixie', run_board_sound_nixie],
	['skynet', run_board_sound_skynet],
] as const
// Issue 4-2: every alias and the value it names.
const ALIASES = [
	['wargames', 'wopr'],
	['matrix', 'trace'],
	['bttf', 'flux'],
	['backtothefuture', 'flux'],
	['metalgear', 'codec'],
	['mgs', 'codec'],
	['steinsgate', 'nixie'],
	['sg', 'nixie'],
	['terminator', 'skynet'],
	['evangelion', 'magi'],
	['eva', 'magi'],
] as const

describe('run_board_theme_defs.THEMES', () => {
	it('names the seven works by their board names after josh-, in the demo key order', () => {
		expect(THEMES).toStrictEqual(['wopr', 'trace', 'flux', 'codec', 'nixie', 'skynet', 'magi'])
	})

	it('names every row of the table, in its order', () => {
		expect(THEMES).toStrictEqual(Object.keys(THEME_DEFS))
	})

	it('is the list the CLI and the worker check a theme name against', () => {
		expect(run_board_theme.THEMES).toBe(THEMES)
	})

	it.each(THEMES)('names the %s board josh-%s', (theme) => {
		expect(THEME_DEFS[theme].name).toBe(`josh-${theme}`)
	})
})

describe('run_board_theme_defs.THEME_ALIASES', () => {
	it.each(ALIASES)('reads %s as %s', (alias, value) => {
		expect(THEME_ALIASES.get(alias)).toBe(value)
	})

	it('holds every alias once and no value as an alias', () => {
		expect([...THEME_ALIASES.keys()]).toStrictEqual(ALIASES.map(([alias]) => alias))
		expect(THEMES.filter((theme) => THEME_ALIASES.has(theme))).toStrictEqual([])
	})
})

describe('run_board_theme_defs.names_of', () => {
	it('names a row added to the table', () => {
		expect(names_of(WIDER)).toStrictEqual([...THEMES, 'amber'])
	})

	it('gives a list the worker check accepts the added theme from', () => {
		expect(z.enum(names_of(WIDER)).parse('amber')).toBe('amber')
	})

	it('refuses a table with no theme', () => {
		expect(() => names_of({})).toThrow('no theme')
	})
})

// joshuafolkken/kit#8365: each row names the voice its typing loops; Issue 4-3: the existing three keep
// theirs, and the four works the demo added type in the wargames teletype.
describe('run_board_theme_defs.THEME_DEFS voice', () => {
	it('types wopr to the teletype trill and trace to the key click', () => {
		expect(THEME_DEFS.wopr.typing).toBe(run_board_sound_typing.teletype_wav)
		expect(THEME_DEFS.trace.typing).toBe(run_board_sound_click.typing_wav)
	})

	// joshuafolkken/kit#8731: flux types every row to the keypad and sounds ENTER after each line.
	it('ac-f9b98b75 types every flux row to the keypad and ends each typed line with ENTER', () => {
		expect(THEME_DEFS.flux.typing).toBe(run_board_sound_keypad.typing_wav)
		expect(THEME_DEFS.flux.typed_end).toBe(run_board_sound_enter.enter_wav)
	})

	it('ends a wopr line in its own typed end and a trace line in none', () => {
		expect(THEME_DEFS.wopr.typed_end).toBe(run_board_sound_palettes_film.wopr_typed_wav)
		expect(THEME_DEFS.trace.typed_end()).toBeUndefined()
	})

	it.each(OWN_VOICES)('types %s in its own voice, its opening timed as wopr', (theme, voice) => {
		const { intro, typing, typed_end } = THEME_DEFS[theme]

		expect({ intro, typing, typed_end }).toStrictEqual({
			intro: THEME_DEFS.wopr.intro,
			typing: voice.typing_wav,
			typed_end: voice.typed_wav,
		})
	})
})

describe('run_board_theme_defs.THEME_DEFS magi voice', () => {
	it('types magi in its own voice, its opening counting its own title', () => {
		const { magi } = THEME_DEFS

		expect(magi.typing).toBe(run_board_sound_palettes_more.magi_typing_wav)
		expect(magi.typed_end).toBe(run_board_sound_palettes_more.magi_typed_wav)
		expect(magi.intro).toStrictEqual({
			line: run_board_theme_magi_data.MAGI_OPEN.title,
			letter_ms: THEME_DEFS.wopr.intro.letter_ms,
		})
	})

	it('keeps the openings the three themes sounded before', () => {
		expect(THEME_DEFS.wopr.intro).toStrictEqual({ line: 'SHALL WE PLAY A GAME?', letter_ms: 50 })
		expect(THEME_DEFS.trace.intro.leads?.lines).toHaveLength(3)
		expect(THEME_DEFS.flux.intro.line).toBe(run_board_sound_keypad.LINE)
	})
})

// joshuafolkken/kit#8917: the base every theme draws over, in the palette the host reads back as roles.
describe('run_board_theme_defs.BASE_LOOK', () => {
	it('draws the green phosphor body, its rules and the TRACE field', () => {
		const { SHADES } = run_board_header_trace

		expect(BASE_LOOK.paint).toBe(SHADES.body)
		expect(BASE_LOOK.rule).toStrictEqual({ dash: SHADES.dark, text: SHADES.mid })
		expect(BASE_LOOK.alert).toBe(run_board_header_trace.field_of)
	})
})
