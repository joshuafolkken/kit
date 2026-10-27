import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_paused_spans } from './lane-paused-spans'

// joshuafolkken/kit#5168: each lane's paused spans, from the `lane-state` lines `lane:pause` and
// `lane:resume` append to the ledger.

const ISSUE = 4216
const OTHER_ISSUE = 4235
const LANE = '/home/.claude/projects/-kit-lanes-4216'
const PAUSED = 'paused'
const RUNNING = 'running'

function change(issue: number, state: typeof PAUSED | typeof RUNNING, at_ms: number): LedgerEntry {
	return { kind: 'lane-state', at: new Date(at_ms).toISOString(), issue, state }
}

describe('lane_paused_spans.by_lane', () => {
	it('spans each pause to the same lane’s next resume, read oldest first', () => {
		const spans = lane_paused_spans.by_lane([
			change(ISSUE, RUNNING, 30),
			change(ISSUE, PAUSED, 10),
			change(OTHER_ISSUE, RUNNING, 15),
			{ kind: 'merge', at: new Date(12).toISOString(), issue: ISSUE },
		])

		expect(spans.get(ISSUE)).toStrictEqual([{ from_ms: 10, to_ms: 30 }])
		expect(spans.get(OTHER_ISSUE)).toStrictEqual([])
	})

	it('keeps a pause with no resume yet open, and a second pause inside it adds nothing', () => {
		const spans = lane_paused_spans.by_lane([change(ISSUE, PAUSED, 10), change(ISSUE, PAUSED, 20)])

		expect(spans.get(ISSUE)).toStrictEqual([{ from_ms: 10, to_ms: Infinity }])
	})

	it('closes a pause at the lane’s next dispatch, as `lane:restart` writes no resume', () => {
		const spans = lane_paused_spans.by_lane([
			change(ISSUE, PAUSED, 10),
			{ kind: 'dispatch', at: new Date(40).toISOString(), issue: OTHER_ISSUE },
			{ kind: 'dispatch', at: new Date(50).toISOString(), issue: ISSUE },
		])

		expect(spans.get(ISSUE)).toStrictEqual([{ from_ms: 10, to_ms: 50 }])
		expect(spans.get(OTHER_ISSUE)).toStrictEqual([])
	})
})

describe('lane_paused_spans.of_lane', () => {
	const spans = lane_paused_spans.by_lane([change(ISSUE, PAUSED, 10), change(ISSUE, RUNNING, 30)])

	it("reads the issue off a lane's transcript directory", () => {
		expect(lane_paused_spans.of_lane(spans, LANE)).toStrictEqual([{ from_ms: 10, to_ms: 30 }])
	})

	it('answers no span for a lane with none, or a directory with no issue', () => {
		expect(lane_paused_spans.of_lane(spans, `${LANE}1`)).toStrictEqual([])
		expect(lane_paused_spans.of_lane(spans, '/home/.claude/projects/-kit')).toStrictEqual([])
	})
})

describe('lane_paused_spans.overlap_ms', () => {
	it('sums how much of the range each span covers', () => {
		const spans = [
			{ from_ms: 0, to_ms: 10 },
			{ from_ms: 20, to_ms: Infinity },
		]

		expect(lane_paused_spans.overlap_ms(spans, 5, 25)).toBe(10)
		expect(lane_paused_spans.overlap_ms(spans, 10, 20)).toBe(0)
	})
})
