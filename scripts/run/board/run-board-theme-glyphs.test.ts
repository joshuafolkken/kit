import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import { run_board_theme } from './run-board-theme'
import { run_board_theme_glyphs } from './run-board-theme-glyphs'
import { run_board_theme_tones, type Tone } from './run-board-theme-tones'

// joshuafolkken/kit#7988: the WarGames theme's icons as text; joshuafolkken/kit#8150: in their tones.

const { EMOJI, SYMBOLS, TURN, textual } = run_board_theme_glyphs
const BOARD = import.meta.dirname
const PICTOGRAPHIC = /\p{Extended_Pictographic}/gu
const PRINTABLE_ASCII = /^[ -~]+$/u
const ESCAPE = '\u{1B}'
const RED = `${ESCAPE}[31m`
const DEFAULT_FOREGROUND = `${ESCAPE}[39m`
const RESET = `${ESCAPE}[0m`
const DIM = `${ESCAPE}[2m`
const BOLD = `${ESCAPE}[1m`
const INTENSITY_OFF = `${ESCAPE}[22m`
// The tone of each text the Issue's table names; `▾` reads as `V` too, but is a disclosure mark.
const TABLE: Readonly<Record<Tone, ReadonlyArray<string>>> = {
	alert: ['P1', 'FL', 'ST', 'XX', '!!', 'XP', 'RL', 'BL', 'NO', 'HT', 'X'],
	caution: ['P2', '??', 'JG', 'LO', 'LC', 'T+', '!', 'RT'],
	human: ['DC', 'HU', 'Q?'],
	done: ['OK', 'FN', 'MG', 'SH', 'GO', 'AC', '+', 'V'],
	running: ['RN', 'IV', 'PL', 'BD', 'RV', 'CM', 'R2', 'RP'],
	idle: ['ZZ', 'HD', 'PS', 'AD', 'OF', 'MU', 'WT', 'LK', 'NB'],
	info: ['HB', 'MM', 'DK', 'CP', 'FT', 'BG', 'EP'],
}
const DISCLOSURE = '▾'
const KANA = 'ｦｱｳｴｵｶｷｹｺｻ'
const TEXTUAL = 'run_board_theme_glyphs.textual'

function board_emoji(): Set<string> {
	const sources = readdirSync(BOARD).filter(
		(name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
	)
	const texts = sources.map((name) => readFileSync(path.join(BOARD, name), 'utf8'))

	return new Set(texts.flatMap((text) => text.match(PICTOGRAPHIC) ?? []))
}

function table_rows(): Array<[string, Tone]> {
	return run_board_theme_tones.TONES.flatMap((tone) =>
		TABLE[tone].map((text): [string, Tone] => [text, tone]),
	)
}

function tones_of(text: string): Array<Tone> {
	const entries = [...EMOJI, ...SYMBOLS].filter(([glyph]) => glyph !== DISCLOSURE)

	return entries.filter(([, [drawn]]) => drawn === text).map(([, [, tone]]) => tone)
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_theme_glyphs table', () => {
	it('has every emoji the board sources draw', () => {
		const missing = [...board_emoji()].filter((emoji) => !EMOJI.has(emoji))

		expect(missing).toStrictEqual([])
	})

	it.each([...EMOJI, ...SYMBOLS])(
		'draws %s as ASCII of its width in a tone',
		(glyph, [text, tone]) => {
			expect(text).toMatch(PRINTABLE_ASCII)
			expect(run_board_fit.width_of(text)).toBe(run_board_fit.width_of(glyph))
			expect(run_board_theme_tones.TONES).toContain(tone)
		},
	)

	it.each(table_rows())('gives %s the %s tone', (text, tone) => {
		const tones = tones_of(text)

		expect(tones.length).toBeGreaterThan(0)
		expect(new Set(tones)).toStrictEqual(new Set([tone]))
	})
})

describe(TEXTUAL, () => {
	beforeEach(() => {
		vi.stubEnv('FORCE_COLOR', '0')
	})

	it('draws an emoji with its variation selector as text padded to the width it took', () => {
		const emoji = '⚠\u{FE0F}'

		expect(textual(`${emoji}|🚨\u{FE0F}|`)).toBe(`${'!'.padEnd(run_board_fit.width_of(emoji))}|P1|`)
	})

	it('draws an emoji the table misses as `?` of its width', () => {
		expect(textual('🦄|')).toBe('? |')
	})

	it('turns the spinner through the line frames, one turn a cycle of the dots', () => {
		const turns = run_board_labels.SPINNER_FRAMES.map((frame) => textual(frame))

		expect(new Set(turns)).toStrictEqual(new Set(TURN))
		expect(turns.at(0)).toBe(TURN[0])
		expect(turns.at(-1)).toBe(TURN.at(-1))
	})
})

describe('run_board_theme_glyphs themed spinners', () => {
	beforeEach(() => {
		vi.stubEnv('FORCE_COLOR', '0')
	})

	it('maps all matrix spinner frames to one-column kana in order (ac-6bea4c04)', () => {
		const turns = run_board_labels.SPINNER_FRAMES.map((frame) => textual(frame, 'matrix'))

		expect(turns.join('')).toBe(KANA)
		expect(turns.map((glyph) => run_board_fit.width_of(glyph))).toStrictEqual(turns.map(() => 1))
	})

	it('keeps spinner frames unchanged with no theme (ac-97dd53ee)', () => {
		const frames = run_board_labels.SPINNER_FRAMES.join('')

		expect(run_board_theme.restyle(undefined, frames)).toBe(frames)
	})

	it('switches cached spinner writes between matrix and wargames (ac-bfea97d9)', () => {
		const frames = run_board_labels.SPINNER_FRAMES.join('')

		for (const theme of ['matrix', 'wargames', 'matrix'] as const) {
			const expected = theme === 'matrix' ? KANA : '│││╱╱───╲╲'

			expect(run_board_theme.restyle(theme, frames)).toBe(expected)
			expect(run_board_theme.restyle(theme, frames)).toBe(expected)
		}
	})
})

describe(TEXTUAL, () => {
	beforeEach(() => {
		vi.stubEnv('FORCE_COLOR', '0')
	})

	it('keeps the rules and gauges', () => {
		expect(textual('■█▁▇┊├└─')).toBe('■█▁▇┊├└─')
	})

	// joshuafolkken/kit#8154: every section heading reads `V -- NAME`.
	it.each(['💻', '📈', '⛽', '🧵', '📌'])('draws the heading icon %s as its rule', (icon) => {
		expect(textual(icon)).toBe('--')
	})
})

describe('run_board_theme_glyphs.textual in color', () => {
	beforeEach(() => {
		vi.stubEnv('FORCE_COLOR', '3')
	})

	it('draws each text in its tone, its padding uncolored, the width as it was', () => {
		const line = '💥 ✅ 🙋 🔄 💤 💓|'
		const toned = textual(line)
		const expected = [
			run_board_theme_tones.toned('alert', 'FL'),
			run_board_theme_tones.toned('done', 'OK'),
			run_board_theme_tones.toned('human', 'DC'),
			run_board_theme_tones.toned('running', 'RN'),
			run_board_theme_tones.toned('idle', 'ZZ'),
			'HB|',
		]

		expect(toned).toBe(expected.join(' '))
		expect(run_board_fit.width_of(toned)).toBe(run_board_fit.width_of(line))
	})

	it('leaves the text inside a color the line gives uncolored, and tones it after the color ends', () => {
		const line = `${RED}✗ 1${DEFAULT_FOREGROUND} ✗ ${RED}💥${RESET}💥`

		expect(textual(line)).toBe(
			`${RED}X 1${DEFAULT_FOREGROUND} ${run_board_theme_tones.toned('alert', 'X')} ${RED}FL${RESET}${run_board_theme_tones.toned('alert', 'FL')}`,
		)
	})

	it('draws no escape where stdout draws no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(stripVTControlCharacters(textual('💥 ✅ 🔄'))).toBe(textual('💥 ✅ 🔄'))
	})
})

describe('run_board_theme_glyphs.textual in bold or dim', () => {
	it('turns a dim or bold the line has on back on after a tone that ends it', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const line = `${DIM}🔄 a ${BOLD}💤${INTENSITY_OFF} 🔄`
		const running = run_board_theme_tones.toned('running', 'RN')

		expect(textual(line)).toBe(
			`${DIM}${running}${DIM} a ${BOLD}${run_board_theme_tones.toned('idle', 'ZZ')}${DIM}${BOLD}${INTENSITY_OFF} ${running}`,
		)
	})
})
