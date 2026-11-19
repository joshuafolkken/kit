import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import { run_board_theme_glyphs } from './run-board-theme-glyphs'

// joshuafolkken/kit#7988: the WarGames theme's icons as text.

const { EMOJI, SYMBOLS, TURN, textual } = run_board_theme_glyphs
const BOARD = import.meta.dirname
const PICTOGRAPHIC = /\p{Extended_Pictographic}/gu
const PRINTABLE_ASCII = /^[ -~]+$/u

function board_emoji(): Set<string> {
	const sources = readdirSync(BOARD).filter(
		(name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
	)
	const texts = sources.map((name) => readFileSync(path.join(BOARD, name), 'utf8'))

	return new Set(texts.flatMap((text) => text.match(PICTOGRAPHIC) ?? []))
}

describe('run_board_theme_glyphs table', () => {
	it('has every emoji the board sources draw', () => {
		const missing = [...board_emoji()].filter((emoji) => !EMOJI.has(emoji))

		expect(missing).toStrictEqual([])
	})

	it.each([...EMOJI, ...SYMBOLS])('draws %s as ASCII of its width', (glyph, text) => {
		expect(text).toMatch(PRINTABLE_ASCII)
		expect(run_board_fit.width_of(text)).toBe(run_board_fit.width_of(glyph))
	})
})

describe('run_board_theme_glyphs.textual', () => {
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

	it('keeps the rules and gauges', () => {
		expect(textual('■█▁▇┊├└─')).toBe('■█▁▇┊├└─')
	})
})
