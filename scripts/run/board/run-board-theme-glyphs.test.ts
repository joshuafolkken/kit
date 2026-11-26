import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_icons } from './run-board-icons'
import { run_board_labels } from './run-board-labels'
import { run_board_theme } from './run-board-theme'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_theme_glyphs } from './run-board-theme-glyphs'
import { run_board_theme_tones, type Tone } from './run-board-theme-tones'

// joshuafolkken/kit#7988: the WarGames theme's icons as text; joshuafolkken/kit#8150: in their tones.

// joshuafolkken/kit#8917: every themed board turns the base look's spinner, its idle tone the base's.
const { EMOJI, SYMBOLS, textual } = run_board_theme_glyphs
const { BASE_LOOK } = run_board_theme_defs
const TURN = [...BASE_LOOK.spinner]
const BOARD = import.meta.dirname
const PICTOGRAPHIC = /\p{Extended_Pictographic}/gu
// Printable ASCII, or one box-drawing character as the rules and gauges the theme keeps (#8505).
const TEXT_GLYPH = /^(?:[ -~]+|[\u{2500}-\u{257F}])$/u
const ESCAPE = '\u{1B}'
const RED = `${ESCAPE}[31m`
const DEFAULT_FOREGROUND = `${ESCAPE}[39m`
const RESET = `${ESCAPE}[0m`
const DIM = `${ESCAPE}[2m`
const BOLD = `${ESCAPE}[1m`
const INTENSITY_OFF = `${ESCAPE}[22m`
// The tone of each text the Issue's table names; `▾` reads as `V` too, but is a disclosure mark.
const TABLE: Readonly<Record<Tone, ReadonlyArray<string>>> = {
	alert: ['P1', 'FL', '[]', 'XX', '!!', 'XP', 'RL', '##', 'NO', 'HT', 'X'],
	caution: ['P2', '??', 'JG', '[_', 'LC', 'T+', '!', '<<'],
	human: [String.raw`\O`, 'HU', 'Q?'],
	done: ['OK', '|>', 'MG', 'SH', '^^', 'AC', '+', 'V'],
	running: ['>>', 'IV', 'PL', 'BD', 'RV', 'CM', 'R2', 'RP'],
	idle: ['ZZ', '..', '||', '>|', 'OF', '<X', 'OO', '<-', '>=', '║'],
	info: ['<3', 'MM', 'DK', 'CP', '**', 'BG', '[+', '->', '//', '<)', '__', '-|', '><', '1.', 'O-'],
}
// The icons #8505 draws as shapes, by the shape each takes.
const SHAPES: ReadonlyArray<readonly [string, string]> = [
	['🧊', '||'],
	['🛑', '[]'],
	['🔄', '>>'],
	['⏩', '>|'],
	['⏳', '..'],
	['🎯', '->'],
	['💓', '<3'],
	['📂', '//'],
	['🔊', '<)'],
	['🔇', '<X'],
	['✨', '**'],
	['🔗', '<-'],
	['💺', '__'],
	['🏁', '|>'],
	['🔚', '-|'],
	['🤝', '><'],
	['📥', String.raw`\/`],
	['📤', '/\\'],
	['⏸', '║'],
	['📅', '>='],
	['🙋', String.raw`\O`],
	['📁', '[+'],
	['🔭', 'OO'],
	['🔁', '<<'],
	['🚧', '##'],
	['🪫', '[_'],
	['📋', '1.'],
	['🚀', '^^'],
	['🔑', 'O-'],
]
// The letters main drew for icons #8505 gave a shape or a new row.
const LETTERS: ReadonlyArray<readonly [string, string]> = [
	['🔄', 'RN'],
	['🔗', 'LK'],
	['⏸', '='],
	['🎯', 'ET'],
	['🕒', 'NW'],
	['🚀', 'T0'],
]
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

// Every text a row draws — its letters, and its shape where it has one — by the glyph it draws.
function texts_of(): Array<readonly [string, string, Tone]> {
	return [...EMOJI, ...SYMBOLS].flatMap(([glyph, [letters, tone, shape]]) =>
		[letters, shape].flatMap((text) => (text === undefined ? [] : [[glyph, text, tone] as const])),
	)
}

function tones_of(text: string): Array<Tone> {
	const entries = texts_of().filter(([glyph]) => glyph !== DISCLOSURE)

	return entries.filter(([, drawn]) => drawn === text).map((entry) => entry[2])
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_theme_glyphs table', () => {
	it('has every emoji the board sources draw', () => {
		const missing = [...board_emoji()].filter((emoji) => !EMOJI.has(emoji))

		expect(missing).toStrictEqual([])
	})

	it.each(texts_of())(
		'draws %s as %s, ASCII or a rule of its width in a tone, unchanged by capitals',
		(glyph, text, tone) => {
			expect(text).toMatch(TEXT_GLYPH)
			expect(text.toUpperCase()).toBe(text)
			expect(run_board_fit.width_of(text)).toBe(run_board_fit.width_of(glyph))
			expect(run_board_theme_tones.TONES).toContain(tone)
		},
	)

	it.each(SHAPES)('draws %s as the shape %s (#8505)', (glyph, shape) => {
		expect(EMOJI.get(glyph)?.[2]).toBe(shape)
	})

	it.each(LETTERS)('keeps the letters %s for %s (#8505)', (glyph, letters) => {
		expect(EMOJI.get(glyph)?.[0]).toBe(letters)
	})

	it.each(['🎯', '🕒', '🚀'])('never draws %s as `?` in any icons (#8505)', (glyph) => {
		for (const icons of run_board_icons.ICONS) {
			expect(textual(glyph, { theme: 'wopr', icons }).trim()).not.toBe('?')
		}
	})

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

	it('draws the running, waiting and paused icons as shapes in their columns (#8505)', () => {
		expect(textual('🔄|🔗|⏸|')).toBe('>>|<-|║|')
	})

	it('draws the same icons as their letters where the icons are `letters` (#8505)', () => {
		expect(textual('🔄|🔗|⏸|', { theme: 'wopr', icons: 'letters' })).toBe('RN|LK|=|')
	})

	it('keeps every icon and the spinner with no theme and `emoji` (#8505)', () => {
		const frame = `🔄|${run_board_labels.SPINNER_FRAMES.join('')}`

		expect(textual(frame, { theme: undefined, icons: 'emoji' })).toBe(frame)
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

	it('maps all base spinner frames to one-column kana in order (ac-6bea4c04)', () => {
		const turns = run_board_labels.SPINNER_FRAMES.map((frame) =>
			textual(frame, { theme: 'trace', icons: 'shapes' }),
		)

		expect(turns.join('')).toBe(KANA)
		expect(turns.map((glyph) => run_board_fit.width_of(glyph))).toStrictEqual(turns.map(() => 1))
	})

	it.each(['wopr', 'trace'] as const)(
		'draws a waiting run as `║` and a running one as `>>` on the %s board (#8505)',
		(theme) => {
			expect(run_board_theme.restyle(theme, '⏸ SITE 🔄 1')).toBe('║ SITE >> 1')
		},
	)

	it('keeps spinner frames unchanged with no theme (ac-97dd53ee)', () => {
		const frames = run_board_labels.SPINNER_FRAMES.join('')

		expect(run_board_theme.restyle(undefined, frames)).toBe(frames)
	})

	it('draws cached spinner writes in the base kana on every theme (ac-bfea97d9)', () => {
		const frames = run_board_labels.SPINNER_FRAMES.join('')

		for (const theme of ['trace', 'wopr', 'magi'] as const) {
			const expected = KANA

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
	it.each(['💻', '📈', '⛽', '🧵', '📌', '🏠', '⌛', '🪢'])(
		'draws the heading icon %s as its rule',
		(icon) => {
			expect(textual(icon)).toBe('--')
		},
	)
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
			run_board_theme_tones.toned('human', String.raw`\O`),
			run_board_theme_tones.toned('running', '>>'),
			run_board_theme_tones.toned('idle', 'ZZ', BASE_LOOK.idle),
			'<3|',
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

// joshuafolkken/kit#8591: `mapped` hands `draw` a line's text only; its escapes pass as they came.
describe('run_board_theme_glyphs.mapped', () => {
	it('draws the text between escapes and keeps a link and a color escape whole', () => {
		const link = `${ESCAPE}]8;id=josh-run-board;https://a.b/c-d\u{7}`
		const drawn: Array<[string, boolean]> = []
		const line = `a-${RED}b-${link}c-${ESCAPE}]8;;\u{7}${DEFAULT_FOREGROUND}d-`
		const mapped = run_board_theme_glyphs.mapped(line, (text, open) => {
			drawn.push([text, open.is_colored])

			return text.toUpperCase()
		})

		expect(mapped).toBe(`A-${RED}B-${link}C-${ESCAPE}]8;;\u{7}${DEFAULT_FOREGROUND}D-`)
		expect(drawn.filter(([text]) => text !== '')).toStrictEqual([
			['a-', false],
			['b-', true],
			['c-', true],
			['d-', false],
		])
	})

	// joshuafolkken/kit#8649: a cursor move is an escape that leaves bold, dim and color as they were.
	it('keeps bold, dim and color across a cursor move and draws the text after it', () => {
		const drawn: Array<[string, string, boolean]> = []
		const line = `${BOLD}${RED}a${ESCAPE}[1;5Hb${ESCAPE}[2;5Hc`
		const mapped = run_board_theme_glyphs.mapped(line, (text, open) => {
			drawn.push([text, open.intensity, open.is_colored])

			return text.toUpperCase()
		})

		expect(mapped).toBe(`${BOLD}${RED}A${ESCAPE}[1;5HB${ESCAPE}[2;5HC`)
		expect(drawn.filter(([text]) => text !== '')).toStrictEqual([
			['a', BOLD, true],
			['b', BOLD, true],
			['c', BOLD, true],
		])
	})
})

// joshuafolkken/kit#8649: a spinner write opens on a cursor move with no color before its glyph.
describe('run_board_theme_glyphs.textual after a cursor move', () => {
	const MOVE = `${ESCAPE}[3;5H`

	beforeEach(() => {
		vi.stubEnv('FORCE_COLOR', '0')
	})

	it.each([
		['wopr', 'ｦ'],
		['trace', 'ｦ'],
	] as const)('turns the spinner glyph after a cursor move on the %s board', (theme, glyph) => {
		expect(textual(`${MOVE}⠋`, { theme, icons: 'shapes' })).toBe(`${MOVE}${glyph}`)
	})

	it('keeps the spinner dot after a cursor move with no theme and `emoji`', () => {
		expect(textual(`${MOVE}⠋`, { theme: undefined, icons: 'emoji' })).toBe(`${MOVE}⠋`)
	})
})

describe('run_board_theme_glyphs.textual in bold or dim', () => {
	it('turns a dim or bold the line has on back on after a tone that ends it', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const line = `${DIM}🔄 a ${BOLD}💤${INTENSITY_OFF} 🔄`
		const running = run_board_theme_tones.toned('running', '>>')

		expect(textual(line)).toBe(
			`${DIM}${running}${DIM} a ${BOLD}${run_board_theme_tones.toned('idle', 'ZZ', BASE_LOOK.idle)}${DIM}${BOLD}${INTENSITY_OFF} ${running}`,
		)
	})
})
