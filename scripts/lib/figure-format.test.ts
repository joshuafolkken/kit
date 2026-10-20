import { describe, expect, it } from 'vitest'
import { figure_format } from './figure-format'

// joshuafolkken/kit#4181: the cost reports, `josh time`, `run:board` and the run event pane print these
// figures through one module, so the outputs each printed before the consolidation are pinned here.

const CENTS = 2
const MILLS = 3
const NINETY_SECONDS_MS = 90_000
const TOKENS = 1_234_567

describe('figure_format.format_usd', () => {
	it('prints four places by default', () => {
		expect(figure_format.format_usd(1.5)).toBe('$1.5000')
	})

	it.each([
		[1.5, CENTS, '$1.50'],
		[0.1234, MILLS, '$0.123'],
	])('prints %d to the %d places a caller asks for', (amount, decimals, expected) => {
		expect(figure_format.format_usd(amount, decimals)).toBe(expected)
	})
})

describe('figure_format.format_tokens', () => {
	it('groups a count by thousands', () => {
		expect(figure_format.format_tokens(TOKENS)).toBe('1,234,567')
	})
})

describe('figure_format.format_share', () => {
	it('prints a percentage to one place', () => {
		expect(figure_format.format_share(1, MILLS)).toBe('33.3%')
	})

	it('answers n/a rather than dividing by a zero whole', () => {
		expect(figure_format.format_share(1, 0)).toBe('n/a')
	})
})

describe('figure_format.format_minutes', () => {
	it('prints a duration in minutes to one place', () => {
		expect(figure_format.format_minutes(NINETY_SECONDS_MS)).toBe('1.5 min')
	})
})

describe('figure_format clocks', () => {
	const moment = new Date(2026, 0, 2, 7, 4, 9).getTime()

	it('pads a clock field to two digits', () => {
		expect(figure_format.two_digits(MILLS)).toBe('03')
	})

	it('prints HH:MM:SS for clock_of', () => {
		expect(figure_format.clock_of(moment)).toBe('07:04:09')
	})

	it('prints HH:MM for minute_of', () => {
		expect(figure_format.minute_of(moment)).toBe('07:04')
	})
})
