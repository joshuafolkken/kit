import { describe, expect, it } from 'vitest'
import { usage_limit_reset } from './usage-limit-reset'

// The reset sentences the harness writes, read against a fixed clock (joshuafolkken/kit#4745).
const MIDNIGHT = '2026-10-24T00:00:00Z'
const NEXT_TOKYO_TEN = '2026-10-25T01:00:00.000Z'

const READABLE = [
	{
		label: 'the observed weekly limit, later the same zone day',
		text: "You've hit your weekly limit · resets 10am (Asia/Tokyo)",
		now: '2026-10-23T16:50:00Z',
		expected: '2026-10-24T01:00:00.000Z',
	},
	{
		label: 'an hour already past in the zone, on the next day',
		text: "You've hit your limit · resets 10am (Asia/Tokyo)",
		now: '2026-10-24T02:00:00Z',
		expected: NEXT_TOKYO_TEN,
	},
	{
		label: 'minutes and a pm hour',
		text: "You've hit your limit · resets 3:30pm (America/New_York)",
		now: '2026-10-24T12:00:00Z',
		expected: '2026-10-24T19:30:00.000Z',
	},
	{
		label: 'across the daylight-saving change',
		text: "You've hit your limit · resets 9am (America/New_York)",
		now: '2026-11-01T05:00:00Z',
		expected: '2026-11-01T14:00:00.000Z',
	},
	{
		label: 'a named date days away',
		text: "You've hit your weekly limit · resets Oct 30, 10am (Asia/Tokyo)",
		now: MIDNIGHT,
		expected: '2026-10-30T01:00:00.000Z',
	},
	{
		label: 'a named date read minutes after it passed, as past',
		text: "You've hit your weekly limit · resets Oct 25, 10am (Asia/Tokyo)",
		now: '2026-10-25T01:05:00Z',
		expected: NEXT_TOKYO_TEN,
	},
	{
		label: 'a January date read in December, in the next year',
		text: "You've hit your weekly limit · resets Jan 2, 10am (Asia/Tokyo)",
		now: '2026-12-30T00:00:00Z',
		expected: '2027-01-02T01:00:00.000Z',
	},
	{
		label: 'a December date read in January, as last year past',
		text: "You've hit your weekly limit · resets Dec 31, 10am (Asia/Tokyo)",
		now: '2027-01-02T00:00:00Z',
		expected: '2026-12-31T01:00:00.000Z',
	},
	{
		label: 'the older epoch form',
		text: 'Claude AI usage limit reached|1793000000',
		now: MIDNIGHT,
		expected: new Date(1_793_000_000_000).toISOString(),
	},
]

function reset_at(text: string, now: string): string | undefined {
	const reset_ms = usage_limit_reset.reset_ms(text, Date.parse(now))

	return reset_ms === undefined ? undefined : new Date(reset_ms).toISOString()
}

describe('usage_limit_reset.reset_ms', () => {
	it.each(READABLE)('reads $label', ({ text, now, expected }) => {
		expect(reset_at(text, now)).toBe(expected)
	})

	it.each([
		{ label: 'an unknown zone', text: "You've hit your limit · resets 10am (Mars/Base)" },
		{ label: 'no time at all', text: "You've hit your limit · resets soon (Asia/Tokyo)" },
		{ label: 'no reset clause', text: "You've hit your weekly limit" },
	])('answers undefined for $label', ({ text }) => {
		expect(reset_at(text, MIDNIGHT)).toBeUndefined()
	})
})
