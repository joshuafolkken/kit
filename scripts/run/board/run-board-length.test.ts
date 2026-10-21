import { describe, expect, it } from 'vitest'
import { run_board_length } from './run-board-length'

const { minute_span_of, span_of } = run_board_length
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

// joshuafolkken/kit#4020: `15:11  🔚 21:46` did not say which was a length. Every length is
// degree-minute-second style, so `:` is a time of day alone.
describe('run_board_length.span_of', () => {
	it('draws zero and a span of seconds as seconds alone', () => {
		expect(span_of(0)).toBe('0″')
		expect(span_of(26 * SECOND + 999)).toBe('26″')
	})

	it('drops a zero hour and pads the seconds after the minutes', () => {
		expect(span_of(3 * MINUTE + 27 * SECOND)).toBe('3′27″')
		expect(span_of(MINUTE + 2 * SECOND)).toBe('1′02″')
	})

	it('pads the minutes and seconds after the hours', () => {
		expect(span_of(HOUR + 15 * MINUTE + 57 * SECOND)).toBe('1°15′57″')
		expect(span_of(HOUR + 5 * SECOND)).toBe('1°00′05″')
	})

	it('carries sixty minutes and more into hours', () => {
		expect(span_of(HOUR + MINUTE + 5 * SECOND)).toBe('1°01′05″')
		expect(span_of(12 * HOUR)).toBe('12°00′00″')
	})

	it('reads a negative span as zero', () => {
		expect(span_of(-MINUTE)).toBe('0″')
	})
})

// joshuafolkken/kit#4044: the estimated finish, drawn to the minute.
describe('run_board_length.minute_span_of', () => {
	it('rounds a length up to its minute and drops the seconds', () => {
		expect(minute_span_of(25 * MINUTE)).toBe('25′')
		expect(minute_span_of(24 * MINUTE + SECOND)).toBe('25′')
	})

	it('draws an hour and more with its minutes in two digits', () => {
		expect(minute_span_of(HOUR + 5 * MINUTE)).toBe('1°05′')
	})

	it('never draws less than a minute', () => {
		expect(minute_span_of(0)).toBe('1′')
		expect(minute_span_of(-MINUTE)).toBe('1′')
	})
})
