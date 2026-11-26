import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_font_data } from './run-board-theme-wopr-font-data'

const { JOINS, K_STEPS, ROW_SPANS, SEGMENTS, SEGMENT_AT } = run_board_theme_wopr_font_data

function letters(text: string): Array<string> {
	return Array.from(text, (ch) => ch)
}

describe('run_board_theme_wopr_font_data', () => {
	it('lights only named segments', () => {
		const used = [...SEGMENTS.values(), ...JOINS.map((join) => join.split(' ', 2)[1] ?? '')]

		const named = new Set(Object.keys(SEGMENT_AT))

		expect(used.flatMap((segments) => letters(segments)).every((name) => named.has(name))).toBe(
			true,
		)
	})

	it('has the digits first, then the letters but I, O and Q', () => {
		const keys = [...SEGMENTS.keys()]

		expect(keys.slice(0, 10).join('')).toBe('0123456789')
		expect(keys).toHaveLength(10 + 26 - 3)
		expect(keys.filter((key) => ['I', 'O', 'Q'].includes(key))).toStrictEqual([])
	})

	it('stretches five rows to twelve half-rows, as the hand-drawn K', () => {
		expect(letters(ROW_SPANS).reduce((sum, span) => sum + Number(span), 0)).toBe(12)
		expect(K_STEPS).toHaveLength(12)
	})
})
