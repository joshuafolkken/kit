import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_overrun } from './lane-overrun'

// joshuafolkken/kit#9164: the overrun note `run:board` draws judges a sized lane by its pace, never an
// adopted theme lane, and an unsized one by the net-minute threshold.

const ISSUE = 9164

function sized(lines: number, is_adopted = false): Array<LedgerEntry> {
	const counts = { files: 2, lines }

	return [
		{
			kind: 'size',
			at: '2026-11-28T10:00:00.000Z',
			issue: ISSUE,
			declared: counts,
			actual: counts,
			...(is_adopted && { adopted: true }),
		},
	]
}

describe('lane_overrun.is_overran', () => {
	it('leaves a long lane efficient for its size within its pace', () => {
		expect(lane_overrun.is_overran(sized(900), ISSUE, 41)).toBe(false)
	})

	it('overruns a short lane slow for its size', () => {
		expect(lane_overrun.is_overran(sized(20), ISSUE, 30)).toBe(true)
	})

	it('judges the unrounded minutes lane:breakdown reads, not the whole minutes it notes', () => {
		expect(lane_overrun.is_overran(sized(100), ISSUE, 25.5)).toBe(false)
	})

	it('never overruns an adopted theme lane', () => {
		expect(lane_overrun.is_overran(sized(20, true), ISSUE, 90)).toBe(false)
	})

	it('judges an unsized lane by the net-minute threshold', () => {
		expect(lane_overrun.is_overran([], ISSUE, 40)).toBe(false)
		expect(lane_overrun.is_overran([], ISSUE, 41)).toBe(true)
	})
})
