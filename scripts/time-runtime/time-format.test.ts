import { describe, expect, it } from 'vitest'
import { time_format } from './time-format'

const TWO_MINUTES_MS = 120_000
const TURN_MS = 12_345

describe('time_format.format_row', () => {
	it('lays the duration out in minutes in the numeric column', () => {
		expect(time_format.format_row('lint', TWO_MINUTES_MS, 'x')).toBe(
			'  lint                      2.0 min   x',
		)
	})
})

describe('time_format.format_seconds', () => {
	it('prints a per-turn figure in seconds to one place', () => {
		expect(time_format.format_seconds(TURN_MS)).toBe('12.3 s')
	})
})
