import { describe, expect, it } from 'vitest'
import { time_format } from './time-format'

// joshuafolkken/kit#1882: the dollar formatter is shared by the phase-cost and launch-cost blocks, so
// the two cannot punctuate an amount differently.

const CENTS = 2
const MILLS = 3

describe('time_format.usd', () => {
	it('formats an amount to the requested precision', () => {
		expect(time_format.usd(1.5, CENTS)).toBe('$1.50')
	})

	it('keeps the finer precision a per-unit figure asks for', () => {
		expect(time_format.usd(0.1234, MILLS)).toBe('$0.123')
	})
})
