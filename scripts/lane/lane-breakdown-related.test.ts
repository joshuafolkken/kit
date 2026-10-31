import { describe, expect, it } from 'vitest'
import { lane_breakdown_related } from './lane-breakdown-related'
import { lane_ledger, type LedgerEntry } from './lane-ledger'

// joshuafolkken/kit#5532: `josh lane:breakdown` names how many changed files the lane's
// `josh test:related` runs narrowed past the reach cap.

const ISSUE = 5532
const OTHER_ISSUE = 5503

function row(issue: number, over_cap?: number): LedgerEntry {
	return {
		kind: lane_ledger.KIND.TEST_RELATED,
		at: '2026-10-31T00:00:00.000Z',
		issue,
		scope: 'related',
		changed: 1,
		synced: 0,
		since_map: 0,
		readers: 0,
		elapsed_ms: 1000,
		...(over_cap !== undefined && { over_cap }),
	}
}

describe('lane_breakdown_related.over_cap_text', () => {
	it('sums the over cap files of the lane runs alone', () => {
		const entries = [row(ISSUE, 1), row(ISSUE), row(ISSUE, 2), row(OTHER_ISSUE, 4)]

		expect(lane_breakdown_related.over_cap_text(entries, ISSUE)).toBe(
			'test:related 3 over cap, in 2 of 3 runs',
		)
	})

	it('prints nothing where no run capped a file', () => {
		expect(lane_breakdown_related.over_cap_text([row(ISSUE, 0), row(ISSUE)], ISSUE)).toBe('')
	})
})
