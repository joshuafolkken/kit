import { describe, expect, it, vi } from 'vitest'
import { lane_breakdown } from './lane-breakdown'
import { lane_breakdown_chain } from './lane-breakdown-chain'
import { lane_breakdown_implement } from './lane-breakdown-implement'
import { lane_breakdown_text } from './lane-breakdown-text'
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

	it('prints nothing for an older line without stages, another lane or the join ship stage', () => {
		const entries = [
			chain(ISSUE),
			chain(ISSUE + 1, [stage(RUN_REVIEW, 1)]),
			chain(ISSUE, [stage('ship', 1)]),
		]

		expect(lane_breakdown_chain.lines_of(entries, ISSUE)).toStrictEqual([])
	})
})

describe('lane_breakdown_text.report_of — the run:chain stages', () => {
	it('prints each stage under the implement bullet', () => {
		const read = vi.spyOn(lane_breakdown_implement, 'read').mockReturnValue([])
		const breakdown = {
			stages: [{ name: lane_breakdown.IMPLEMENT_STAGE, ms: 10 * MINUTE_MS }],
			excluded_ms: 0,
			slept_ms: 0,
			yield_ms: 0,
			waits: [],
			implement: [],
			pre_detach: [],
			ship: [],
		}
		const entries = [chain(ISSUE, [stage(CHECK_RELATED, 2)])]
		const report = lane_breakdown_text.report_of(ISSUE, breakdown, entries)

		expect(lane_breakdown_text.comment(ISSUE, 10, report)).toMatch(
			/\n- implement [^\n]*\n {2}- run:chain › check:related ×1 2\.0 min/u,
		)
		read.mockRestore()
	})
})
