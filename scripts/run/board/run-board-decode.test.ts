import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_decode } from './run-board-decode'
import { run_board_fit } from './run-board-fit'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_labels } from './run-board-labels'
import { run_board_rain } from './run-board-rain'

// joshuafolkken/kit#8356: the matrix board's new row resolves from the left out of code — as wide while
// it decodes as once it is through.

const { HEAD_COLUMNS, decoded } = run_board_decode
const { width_of } = run_board_fit
const ESC = '\u{1B}'
const PLAIN = 'abcdefghij   '
const PLAIN_LAST = 10
const ICON = '🟢'
const STYLED = `${ESC}[32mab${ESC}[0m ${ICON} cd   `
const HEAD = run_board_header_trace.SHADES.head

afterEach(() => {
	vi.unstubAllEnvs()
})

function half(): number {
	return 0.5
}

function visible(text: string): string {
	return stripVTControlCharacters(text)
}

function drawn_width(text: string): number {
	return width_of(visible(text))
}

// The width `text` is drawn with `columns` of it resolved.
function width_at(text: string, columns: number): number {
	return drawn_width(decoded(text, columns, half))
}

// Every column count from none to the row's whole width.
function columns_of(text: string): Array<number> {
	return Array.from({ length: drawn_width(text) + 1 }, (_, index) => index)
}

describe('run_board_decode.decoded — the width', () => {
	it.each([PLAIN, STYLED])('keeps %j as wide at every column resolved', (text) => {
		vi.stubEnv('FORCE_COLOR', '3')
		const widths = columns_of(text).map((columns) => width_at(text, columns))

		expect(new Set(widths)).toStrictEqual(new Set([drawn_width(text)]))
	})

	it('keeps a character two columns wide as it is in the code part', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(visible(decoded(STYLED, 0, half))).toContain(ICON)
	})
})

describe('run_board_decode.decoded — the parts', () => {
	it('draws the resolved columns as the row, then the next two in the head’s white-green', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const text = decoded(PLAIN, 3, half)

		expect(visible(text).slice(0, 3 + HEAD_COLUMNS)).toBe('abcde')
		expect(text).toContain(run_board_labels.painted(HEAD, 'd'))
		expect(text).toContain(run_board_labels.painted(HEAD, 'e'))
	})

	it('draws the rest to the last character as the rain’s glyphs and keeps the blanks after it', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const code = visible(decoded(PLAIN, 3, half)).slice(3 + HEAD_COLUMNS)

		expect([...code.trimEnd()].every((glyph) => run_board_rain.GLYPHS.includes(glyph))).toBe(true)
		expect(code).toHaveLength(PLAIN.length - 3 - HEAD_COLUMNS)
		expect(code.endsWith(' '.repeat(3))).toBe(true)
	})

	it('keeps the blanks the row starts with blank, as the demo leaves them', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		const text = visible(decoded(`   ${PLAIN}`, 0, half))

		expect(text.slice(0, 3)).toBe(' '.repeat(3))
		expect(run_board_rain.GLYPHS).toContain(text.charAt(3))
	})

	it.each([PLAIN_LAST, PLAIN_LAST + 1, PLAIN.length])(
		'returns the row whole once %i columns are resolved',
		(columns) => {
			expect(decoded(PLAIN, columns, half)).toBe(PLAIN)
		},
	)
})
