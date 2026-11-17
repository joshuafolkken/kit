import { describe, expect, it } from 'vitest'
import { lane_breakdown } from './lane-breakdown'
import type { LedgerEntry } from './lane-ledger'
import { lane_over_estimate, type EstimateScale } from './lane-over-estimate'

// joshuafolkken/kit#7785: the #7737 lane ran to size, the #7724 lane ran past its estimate (both
// shapes as that Issue recorded them), and a lane with no recorded size has no estimate.

const MINUTE_MS = 60_000
const TO_SIZE = 7737
const OVER = 7724
const UNSIZED = 7790
const START = Date.parse('2026-11-17T00:00:00.000Z')
const WINDOW = { since_ms: START, until_ms: START + 24 * 60 * MINUTE_MS }
// One declared line per 1/100 of the rate's median minutes, at growth 1, projects the median.
const DECLARED_LINES = 100

function size(issue: number): Extract<LedgerEntry, { kind: 'size' }> {
	const counts = { files: 4, lines: DECLARED_LINES }

	return { kind: 'size', at: '2026-11-17T01:00:00.000Z', issue, declared: counts, actual: counts }
}

function scale_at(median: number): EstimateScale {
	return {
		sizes: [size(TO_SIZE), size(OVER)],
		rate: { median, lanes: 9 },
		growth: { files: 1, lines: 1 },
	}
}

function implement(minutes: number): Array<{ name: string; ms: number }> {
	return [
		{ name: 'start to plan', ms: 2 * MINUTE_MS },
		{ name: lane_breakdown.IMPLEMENT_STAGE, ms: minutes * MINUTE_MS },
	]
}

describe('lane_over_estimate.estimate_of', () => {
	it('puts the #7737 shape on the to-size side', () => {
		const estimate = lane_over_estimate.estimate_of(scale_at(60.8), TO_SIZE, implement(43.1))

		expect(estimate.side).toBe(lane_over_estimate.SIDE.TO_SIZE)
		expect(lane_over_estimate.cell(estimate)).toBe('60.8 min ×0.71 to size')
	})

	it('puts the #7724 shape on the over-estimate side', () => {
		const estimate = lane_over_estimate.estimate_of(scale_at(24.3), OVER, implement(77.2))

		expect(estimate.side).toBe(lane_over_estimate.SIDE.OVER)
		expect(lane_over_estimate.cell(estimate)).toBe('24.3 min ×3.18 over estimate')
	})

	it('reads a lane with no recorded size as no estimate', () => {
		const estimate = lane_over_estimate.estimate_of(scale_at(60.8), UNSIZED, implement(90))

		expect(lane_over_estimate.cell(estimate)).toBe(lane_over_estimate.SIDE.NONE)
	})

	it('reads a lane as no estimate when no rate was measured', () => {
		const scale = { ...scale_at(60.8), rate: undefined }

		expect(lane_over_estimate.estimate_of(scale, TO_SIZE, implement(43.1)).side).toBe(
			lane_over_estimate.SIDE.NONE,
		)
	})
})

describe('lane_over_estimate.counts_line', () => {
	it('counts each side apart, a no-estimate lane on neither', () => {
		const estimates = [
			lane_over_estimate.estimate_of(scale_at(60.8), TO_SIZE, implement(43.1)),
			lane_over_estimate.estimate_of(scale_at(24.3), OVER, implement(77.2)),
			lane_over_estimate.estimate_of(scale_at(60.8), UNSIZED, implement(90)),
		]

		expect(lane_over_estimate.counts_line(estimates)).toBe(
			'estimate: over estimate 1 · to size 1 · no estimate 1',
		)
	})
})

describe('lane_over_estimate.scale_of', () => {
	it('takes the sizes merged in the window', () => {
		const entries: Array<LedgerEntry> = [
			size(TO_SIZE),
			{ kind: 'merge', at: '2026-11-17T02:00:00.000Z', issue: TO_SIZE },
		]

		expect(
			lane_over_estimate.scale_of(entries, WINDOW).sizes.map((entry) => entry.issue),
		).toStrictEqual([TO_SIZE])
	})
})
