import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'

// joshuafolkken/kit#3430: the board's words follow the session language, and every time it draws is an
// `HH:MM:SS` clock or span.

const { clock_of, span_of, words_of } = run_board_labels
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

describe('run_board_labels.words_of', () => {
	it('answers Japanese for ja and English for any other language', () => {
		expect(words_of('ja').no_run).toBe('ランなし')
		expect(words_of('en').no_run).toBe('no run')
		expect(words_of('fr').no_run).toBe('no run')
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

describe('run_board_labels.clock_of', () => {
	it('draws the local wall clock of a moment', () => {
		const moment = new Date(2026, 9, 8, 7, 4, 9).getTime()

		expect(clock_of(moment)).toBe('07:04:09')
	})
})
