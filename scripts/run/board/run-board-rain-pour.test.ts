import { describe, expect, it } from 'vitest'
import { run_board_rain_pour } from './run-board-rain-pour'
import { run_board_type_rows, type Typing } from './run-board-type-rows'

// joshuafolkken/kit#8369: when the matrix board's rain pours, in the drops' steps.

const { is_pouring, merged, pour_steps, poured_steps } = run_board_rain_pour
const TYPING: Typing = {
	seen: undefined,
	lines: [{ key: 'k', index: 0, row: 3, text: 'ABCDE', prefix_columns: 0, start_ms: 1000 }],
}

describe('run_board_rain_pour.merged', () => {
	it('sorts the spans and folds the ones that overlap or touch, so two rows pour once', () => {
		const spans = [
			{ from_ms: 3000, to_ms: 3100 },
			{ from_ms: 1000, to_ms: 1200 },
			{ from_ms: 1100, to_ms: 1300 },
			{ from_ms: 1300, to_ms: 1400 },
		]

		expect(merged(spans)).toEqual([
			{ from_ms: 1000, to_ms: 1400 },
			{ from_ms: 3000, to_ms: 3100 },
		])
	})
})

describe('run_board_rain_pour — the steps that pour', () => {
	const spans = [
		{ from_ms: 1000, to_ms: 1200 },
		{ from_ms: 2010, to_ms: 2100 },
	]

	it('pours on each step a span holds, its end excluded', () => {
		expect(pour_steps(spans, 0, 3000)).toEqual([1000, 1050, 1100, 1150, 2050])
		expect(pour_steps(spans, 1100, 2060)).toEqual([1100, 1150, 2050])
	})

	it('counts the same steps it lists', () => {
		expect(poured_steps(spans, 0, 3000)).toBe(5)
		expect(poured_steps(spans, 1100, 2060)).toBe(3)
		expect(poured_steps(spans, 1200, 2000)).toBe(0)
	})

	it('pours from a span’s first moment up to, not at, its end', () => {
		expect(is_pouring(spans, 999)).toBe(false)
		expect(is_pouring(spans, 1000)).toBe(true)
		expect(is_pouring(spans, 1199)).toBe(true)
		expect(is_pouring(spans, 1200)).toBe(false)
	})
})

describe('run_board_type_rows.spans_of — the typing source the lamps and the pour share', () => {
	it('spans a row from its start to the moment is_typing turns false', () => {
		const [span] = run_board_type_rows.spans_of(TYPING)

		expect(span).toEqual({ from_ms: 1000, to_ms: 1200 })
		expect(run_board_type_rows.is_typing(TYPING, 1199)).toBe(true)
		expect(run_board_type_rows.is_typing(TYPING, 1200)).toBe(false)
	})
})
