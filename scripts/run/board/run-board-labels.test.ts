import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'

// joshuafolkken/kit#3430: the board's words follow the session language, and every time it draws is an
// `HH:MM:SS` clock or span.

const { bar_of, clock_of, elapsed_of, left_of, span_of, words_of } = run_board_labels
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

describe('run_board_labels.words_of', () => {
	it('answers Japanese for ja and English for any other language', () => {
		expect(words_of('ja').no_run).toBe('ランなし')
		expect(words_of('en').no_run).toBe('no run')
		expect(words_of('fr').no_run).toBe('no run')
	})

	it('carries the same non-empty words in both languages', () => {
		const ja = words_of('ja')
		const en = words_of('en')

		expect(Object.keys(ja)).toStrictEqual(Object.keys(en))
		expect(Object.values(ja).every((word) => word.length > 0)).toBe(true)
		expect(Object.values(en).every((word) => word.length > 0)).toBe(true)
	})
})

describe('run_board_labels.span_of', () => {
	it('draws a span as zero-padded hours, minutes and seconds', () => {
		expect(span_of(2 * HOUR + 5 * MINUTE + 7 * SECOND + 999)).toBe('02:05:07')
		expect(span_of(26 * HOUR)).toBe('26:00:00')
	})

	it('reads a negative span as zero', () => {
		expect(span_of(-MINUTE)).toBe('00:00:00')
	})
})

// joshuafolkken/kit#3444: elapsed times are a short `MM:SS`, time left is `7h38m`, and the one bar the
// board draws fills in proportion.
describe('run_board_labels.elapsed_of', () => {
	it('draws minutes and seconds whose minutes never carry into hours', () => {
		expect(elapsed_of(42 * SECOND + 999)).toBe('00:42')
		expect(elapsed_of(HOUR + MINUTE + 5 * SECOND)).toBe('61:05')
		expect(elapsed_of(2 * HOUR + 5 * MINUTE + 30 * SECOND)).toBe('125:30')
	})

	it('reads a negative elapsed time as zero', () => {
		expect(elapsed_of(-MINUTE)).toBe('00:00')
	})
})

describe('run_board_labels.left_of', () => {
	it('draws hours and zero-padded minutes, a passed deadline as zero', () => {
		expect(left_of(7 * HOUR + 38 * MINUTE + 59 * SECOND)).toBe('7h38m')
		expect(left_of(5 * MINUTE)).toBe('0h05m')
		expect(left_of(-MINUTE)).toBe('0h00m')
	})
})

describe('run_board_labels.bar_of', () => {
	it('fills the bar in proportion, empty for nothing to do and full when done', () => {
		expect(bar_of(1, 4, 8)).toBe('━━░░░░░░')
		expect(bar_of(0, 0, 4)).toBe('░░░░')
		expect(bar_of(5, 4, 4)).toBe('━━━━')
		expect(bar_of(0, 1)).toHaveLength(20)
	})
})

describe('run_board_labels.clock_of', () => {
	it('draws the local wall clock of a moment', () => {
		const moment = new Date(2026, 9, 8, 7, 4, 9).getTime()

		expect(clock_of(moment)).toBe('07:04:09')
	})
})
