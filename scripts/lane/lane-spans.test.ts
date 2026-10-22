import { describe, expect, it } from 'vitest'
import { lane_spans, type IssueAt } from './lane-spans'

// joshuafolkken/kit#4463: the spans `josh lane:stats` and `run:board` both build — each start until the
// first end of its own issue, before that issue's next start.

const ISSUE = 4463
const OTHER = 4464

function at(at_ms: number, issue: number = ISSUE): IssueAt {
	return { issue, at_ms }
}

describe('lane_spans.issue_spans', () => {
	it('ends each start at the first end of its own issue', () => {
		const spans = lane_spans.issue_spans({
			starts: [at(1), at(5)],
			bounds: [at(1), at(5)],
			ends: [at(2, OTHER), at(3), at(7)],
		})

		expect(spans).toStrictEqual([
			{ from_ms: 1, end_ms: 3 },
			{ from_ms: 5, end_ms: 7 },
		])
	})

	it('leaves a start open when its issue starts again before any end', () => {
		const spans = lane_spans.issue_spans({
			starts: [at(1), at(5)],
			bounds: [at(1), at(5)],
			ends: [at(6)],
		})

		expect(spans).toStrictEqual([
			{ from_ms: 1, end_ms: undefined },
			{ from_ms: 5, end_ms: 6 },
		])
	})
})
