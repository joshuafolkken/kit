import { describe, expect, it } from 'vitest'
import { time_instant } from './time-instant'

const ISO = '2026-09-03T09:00:32Z'

describe('time_instant.parse_instant', () => {
	it('reads an ISO timestamp as milliseconds', () => {
		expect(time_instant.parse_instant(ISO)).toBe(Date.parse(ISO))
	})

	// Not `NaN`, which propagates silently through every arithmetic that touches it, and not `0`,
	// which reads as the epoch — putting a span in 1970 and a merge before its own pull request.
	// The absent case arrives as a wire `null` from GitHub and as `undefined` from a transcript; both
	// take the same branch, so one of them is enough to pin the behavior.
	it('answers undefined for anything it cannot read', () => {
		expect(time_instant.parse_instant('not a date')).toBeUndefined()
		expect(time_instant.parse_instant(undefined)).toBeUndefined()
	})
})
