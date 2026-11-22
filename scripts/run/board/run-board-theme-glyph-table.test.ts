import { describe, expect, it } from 'vitest'
import { run_board_theme_glyph_table } from './run-board-theme-glyph-table'

const { EMOJI, SYMBOLS, glyphs_of } = run_board_theme_glyph_table

describe('run_board_theme_glyph_table', () => {
	it('reads a row without a shape as its letters and tone', () => {
		expect(EMOJI.get('🚨')).toStrictEqual(['P1', 'alert'])
	})

	it('reads a row with a shape as its letters, tone and shape', () => {
		expect(EMOJI.get('🔄')).toStrictEqual(['RN', 'running', '>>'])
	})

	it('keeps the space in a letters field and the backslash in a shape', () => {
		expect(EMOJI.get('🔧')?.[0]).toBe('> ')
		expect(EMOJI.get('🙋')?.[2]).toBe(String.raw`\O`)
		expect(EMOJI.get('📤')?.[2]).toBe('/\\')
	})

	it('reads the one-column symbols', () => {
		expect(SYMBOLS.get('✗')).toStrictEqual(['X', 'alert'])
	})

	it('refuses a row naming no tone', () => {
		expect(() => glyphs_of('🔄,RN,spinning')).toThrow('Glyph table names no tone "spinning"')
	})
})
