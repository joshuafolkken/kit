import { describe, expect, it } from 'vitest'
import { lane_breakdown_text, type Report } from './lane-breakdown-text'

// joshuafolkken/kit#4995: the breakdown reads as one bullet per stage on the lane's Issue and as one
// line at the head of the investigation's prompt, the implementation's kinds beside it.

const MINUTE_MS = 60_000
const ISSUE = 4970

const REPORT: Report = {
	breakdown: {
		stages: [
			{ name: 'implement', ms: 51 * MINUTE_MS },
			{ name: 'start to plan', ms: 10 * MINUTE_MS },
		],
		excluded_ms: 2 * MINUTE_MS,
		waits: [],
		implement: [],
	},
	detail: {
		kinds: [
			{ name: 'editing & thinking', ms: 41 * MINUTE_MS },
			{ name: 'gate', ms: 10 * MINUTE_MS },
		],
		background: 2,
	},
}

const IMPLEMENT_TEXT =
	'implement 51.0 min (editing & thinking 41.0 min, gate 10.0 min, 2 backgrounded calls, their waits in editing & thinking)'
const EXCLUDED_TEXT = 'waits taken out (park, outage, usage limit) 2.0 min'

describe('lane_breakdown_text.comment', () => {
	it('heads the stages with the net minutes and the command that prints them', () => {
		expect(lane_breakdown_text.comment(ISSUE, 62, REPORT).split('\n')).toStrictEqual([
			'Net time by stage, longest first, 62 min of net time (`pnpm josh lane:breakdown 4970`):',
			'',
			`- ${IMPLEMENT_TEXT}`,
			'- start to plan 10.0 min',
			`- ${EXCLUDED_TEXT}`,
		])
	})
})

describe('lane_breakdown_text.line', () => {
	it('writes the stages on one line', () => {
		expect(lane_breakdown_text.line(REPORT)).toBe(
			`Net time by stage, longest first: ${IMPLEMENT_TEXT}; start to plan 10.0 min; ${EXCLUDED_TEXT}.`,
		)
	})

	it('names no backgrounded calls where there were none', () => {
		const report = { ...REPORT, detail: { ...REPORT.detail, background: 0 } }

		expect(lane_breakdown_text.line(report)).not.toContain('backgrounded')
	})
})
