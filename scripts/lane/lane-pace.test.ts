import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_pace } from './lane-pace'

// joshuafolkken/kit#9164: a lane judged by its net minutes past the fixed cost per 100 actual lines,
// not by a fixed number of minutes.

const ISSUE = 9164

function sized(lines: number, is_adopted = false): Array<LedgerEntry> {
	const counts = { files: 8, lines }

	return [
		{
			kind: 'size',
			issue: ISSUE,
			at: '2026-11-28T10:00:00.000Z',
			declared: counts,
			actual: counts,
			...(is_adopted && { adopted: true }),
		},
	]
}

function is_slow(lines: number, minutes: number): boolean {
	return lane_pace.is_slow(lane_pace.of(sized(lines), ISSUE, minutes))
}

describe('lane_pace.of — slow for its size', () => {
	it('judges #9117 (321 lines, 68.9 min) and #9140 (195 lines, 51.8 min) slow', () => {
		expect(is_slow(321, 68.9)).toBe(true)
		expect(is_slow(195, 51.8)).toBe(true)
	})
	it('keeps an efficient large lane (900 lines, 90 min) within the pace', () => {
		expect(is_slow(900, 90)).toBe(false)
	})
	it('subtracts the fixed cost before the rate, never below zero', () => {
		expect(lane_pace.rate_of(lane_pace.FIXED_MINUTES, 50)).toBe(0)
		expect(lane_pace.rate_of(5, 50)).toBe(0)
		expect(lane_pace.rate_of(22, 50)).toBe(20)
	})
	it('reads the latest size entry of the issue', () => {
		const entries = [...sized(10), ...sized(2000)]

		expect(lane_pace.is_slow(lane_pace.of(entries, ISSUE, 60))).toBe(false)
	})
})

describe('lane_pace.of — unjudged lanes', () => {
	it('leaves an adopted theme lane unjudged however slow its size reads', () => {
		const pace = lane_pace.of(sized(10, true), ISSUE, 120)

		expect(pace).toStrictEqual({ kind: 'unjudged', reason: 'adopted' })
		expect(lane_pace.is_slow(pace)).toBe(false)
		expect(lane_pace.text(pace)).toBe('pace not judged: an adopted theme lane')
	})
	it('leaves a lane with no size, or another issue only, unsized', () => {
		expect(lane_pace.of([], ISSUE, 120)).toStrictEqual({ kind: 'unjudged', reason: 'unsized' })
		expect(lane_pace.of(sized(100), ISSUE + 1, 120).kind).toBe('unjudged')

		const pace = lane_pace.of([], ISSUE, 1)

		expect(lane_pace.text(pace)).toBe('pace not judged: no recorded size')
	})
	it('names the rate, the fixed cost and the side of the pace', () => {
		const pace = lane_pace.of(sized(100), ISSUE, 22)

		expect(lane_pace.text(pace)).toBe(
			'10.0 min / 100 lines past the 12-min fixed cost, within the 13.7-min pace',
		)
	})
})
