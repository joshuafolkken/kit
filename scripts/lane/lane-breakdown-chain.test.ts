import { describe, expect, it } from 'vitest'
import { lane_breakdown_chain } from './lane-breakdown-chain'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import type { ChainStageEntry } from './lane-ledger-schema-ship'

const ISSUE = 7736
const AT = '2026-11-17T00:00:00.000Z'
const MINUTE_MS = 60_000
const CHECK_RELATED = 'check:related'
const RUN_REVIEW = 'run:review'

function stage(name: string, minutes: number): ChainStageEntry {
	return { name, at: AT, elapsed_ms: minutes * MINUTE_MS }
}

function chain(issue: number, stages?: Array<ChainStageEntry>): LedgerEntry {
	return {
		kind: lane_ledger.KIND.CHAIN,
		at: AT,
		issue,
		elapsed_ms: MINUTE_MS,
		join: false,
		...(stages !== undefined && { stages }),
	}
}

describe('lane_breakdown_chain.lines_of', () => {
	it('sums each stage over the lane runs, longest first', () => {
		const entries = [
			chain(ISSUE, [stage(RUN_REVIEW, 1), stage(CHECK_RELATED, 2)]),
			chain(ISSUE, [stage(CHECK_RELATED, 1)]),
		]

		expect(lane_breakdown_chain.lines_of(entries, ISSUE)).toStrictEqual([
			'run:chain › check:related ×2 3.0 min',
			'run:chain › run:review ×1 1.0 min',
		])
	})

	it('prints nothing for an older line without stages or another lane', () => {
		const entries = [chain(ISSUE), chain(ISSUE + 1, [stage(RUN_REVIEW, 1)])]

		expect(lane_breakdown_chain.lines_of(entries, ISSUE)).toStrictEqual([])
	})
})
