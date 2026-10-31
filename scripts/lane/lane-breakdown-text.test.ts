import { describe, expect, it, vi } from 'vitest'
import { lane_breakdown } from './lane-breakdown'
import { lane_breakdown_implement } from './lane-breakdown-implement'
import { lane_breakdown_text, type Report } from './lane-breakdown-text'
import type { ShipLapEntry, StageEntry, TestPinnedEntry, TestRelatedEntry } from './lane-ledger'

// joshuafolkken/kit#4995: the breakdown reads as one bullet per stage on the lane's Issue and as one
// line at the head of the investigation's prompt, the implementation's kinds beside it.

const MINUTE_MS = 60_000
const ISSUE = 4970
const AT = '2026-10-28T01:00:00.000Z'

const REPORT: Report = {
	breakdown: {
		stages: [
			{ name: 'implement', ms: 51 * MINUTE_MS },
			{ name: 'start to plan', ms: 10 * MINUTE_MS },
		],
		excluded_ms: 3 * MINUTE_MS,
		slept_ms: MINUTE_MS,
		yield_ms: MINUTE_MS,
		waits: [],
		implement: [],
		pre_detach: [],
		ship: [],
	},
	detail: {
		kinds: [
			{ name: 'editing & thinking', ms: 41 * MINUTE_MS },
			{ name: 'gate', ms: 10 * MINUTE_MS },
		],
		background: 2,
		untimed: new Map(),
	},
}

const IMPLEMENT_TEXT =
	'implement 51.0 min, over budget +39 min (editing & thinking 41.0 min, gate 10.0 min, 2 backgrounded calls, their waits in editing & thinking)'
const PLAN_TEXT = 'start to plan 10.0 min, over budget +7 min'
const EXCLUDED_TEXT =
	'waits taken out (park, outage, usage limit, yield, host sleep) 3.0 min, of which yield wait 1.0 min, of which host sleep 1.0 min'

describe('lane_breakdown_text.comment', () => {
	it('heads the stages with the net minutes and the command that prints them', () => {
		expect(lane_breakdown_text.comment(ISSUE, 62, REPORT).split('\n')).toStrictEqual([
			'Net time by stage, longest first, 62 min of net time (`pnpm josh lane:breakdown 4970`):',
			'',
			`- ${IMPLEMENT_TEXT}`,
			`- ${PLAN_TEXT}`,
			`- ${EXCLUDED_TEXT}`,
		])
	})
})

describe('lane_breakdown_text.line', () => {
	it('writes the stages on one line', () => {
		expect(lane_breakdown_text.line(REPORT)).toBe(
			`Net time by stage, longest first: ${IMPLEMENT_TEXT}; ${PLAN_TEXT}; ${EXCLUDED_TEXT}.`,
		)
	})

	it('names no backgrounded calls where there were none', () => {
		const report = { ...REPORT, detail: { ...REPORT.detail, background: 0 } }

		expect(lane_breakdown_text.line(report)).not.toContain('backgrounded')
	})

	// joshuafolkken/kit#5262: the discarded run:review background probes have a line of their own.
	it('writes the discarded probes line before the waits taken out, and none when empty', () => {
		const discarded = 'background test:pinned probes discarded 2, 3.0 min'

		expect(lane_breakdown_text.line({ ...REPORT, discarded })).toContain(
			`; ${discarded}; ${EXCLUDED_TEXT}.`,
		)
		expect(lane_breakdown_text.line({ ...REPORT, discarded: '' })).toBe(
			lane_breakdown_text.line(REPORT),
		)
	})

	// joshuafolkken/kit#5078: the ship pre-detach line says what its test:pinned probe spent.
	it('writes the test:pinned detail on the ship pre-detach line alone', () => {
		const pinned = ' (test:pinned 1 hunks, 0 cached, 1 probed, scripts/a.ts 1.0 min)'
		const stages = [{ name: 'ship pre-detach', ms: MINUTE_MS }, ...REPORT.breakdown.stages]
		const report = { ...REPORT, breakdown: { ...REPORT.breakdown, stages }, pinned }

		expect(lane_breakdown_text.line(report)).toContain(
			`: ship pre-detach 1.0 min${pinned}; implement`,
		)
	})
})

// joshuafolkken/kit#5296: the ship review line carries why it ran or was skipped.
describe('lane_breakdown_text — ship stage reasons', () => {
	const REASON = 'reused: round 1 attested on this branch, its tree held'
	const name = 'ship review'
	const stages = [{ name, ms: MINUTE_MS }, ...REPORT.breakdown.stages]
	const reasons = new Map([[name, REASON]])

	it('writes the reason beside the ship review minutes', () => {
		const report = { ...REPORT, breakdown: { ...REPORT.breakdown, stages, reasons } }

		expect(lane_breakdown_text.line(report)).toContain(
			`: ship review 1.0 min (${REASON}); implement`,
		)
	})

	it('writes the ship review minutes alone when no reason was given', () => {
		const report = { ...REPORT, breakdown: { ...REPORT.breakdown, stages } }

		expect(lane_breakdown_text.line(report)).toContain(': ship review 1.0 min; implement')
	})
})

// joshuafolkken/kit#5294: a ship stage's laps print under it, longest first, and beside it on one line.
describe('lane_breakdown_text — ship stage laps', () => {
	const stages = [{ name: 'ship gate', ms: 6 * MINUTE_MS }]
	const laps = new Map([
		[
			'ship gate',
			[
				{ name: 'josh gate', ms: 4 * MINUTE_MS },
				{ name: 'scoped pair', ms: 2 * MINUTE_MS },
			],
		],
	])
	const report = { ...REPORT, breakdown: { ...REPORT.breakdown, stages }, laps }

	it('prints the laps as sub-bullets under their stage', () => {
		expect(lane_breakdown_text.comment(ISSUE, 6, report).split('\n').slice(2, 5)).toStrictEqual([
			'- ship gate 6.0 min',
			'  - josh gate 4.0 min',
			'  - scoped pair 2.0 min',
		])
	})

	it('writes the laps in brackets beside their stage on one line', () => {
		expect(lane_breakdown_text.line(report)).toContain(
			': ship gate 6.0 min [josh gate 4.0 min, scoped pair 2.0 min];',
		)
	})
})

// joshuafolkken/kit#5297: a backgrounded subagent call is counted beside its type, at no time.
describe('lane_breakdown_text.line — subagent types', () => {
	it('counts the backgrounded subagent calls beside their type', () => {
		const reviewer = { name: 'subagent: reviewer', ms: 0 }
		const detail = {
			kinds: [...REPORT.detail.kinds, reviewer],
			background: 1,
			untimed: new Map([[reviewer.name, 1]]),
		}

		expect(lane_breakdown_text.line({ ...REPORT, detail })).toContain(
			'subagent: reviewer 0.0 min + 1 backgrounded, untimed',
		)
	})
})

describe('lane_breakdown_text.report_of', () => {
	it("reads the lane's discarded run:review probes off the ledger", () => {
		const read = vi.spyOn(lane_breakdown_implement, 'read').mockReturnValue([])
		const entry: TestPinnedEntry = {
			kind: 'test-pinned',
			at: AT,
			issue: ISSUE,
			held: 0,
			probes: [],
			elapsed_ms: 2 * MINUTE_MS,
			discarded: true,
		}

		const report = lane_breakdown_text.report_of(ISSUE, REPORT.breakdown, [entry])

		expect(report.discarded).toBe('background test:pinned probes discarded 1, 2.0 min')
		read.mockRestore()
	})
})

// joshuafolkken/kit#5532: the lane's test:related files past the reach cap have a line of their own.
describe('lane_breakdown_text — test:related over cap', () => {
	it('reads the over cap files off the ledger and writes them before the waits taken out', () => {
		const read = vi.spyOn(lane_breakdown_implement, 'read').mockReturnValue([])
		const entry: TestRelatedEntry = {
			kind: 'test-related',
			at: AT,
			issue: ISSUE,
			scope: 'related',
			changed: 1,
			synced: 0,
			since_map: 0,
			readers: 0,
			over_cap: 2,
			elapsed_ms: MINUTE_MS,
		}
		const report = lane_breakdown_text.report_of(ISSUE, REPORT.breakdown, [entry])

		expect(lane_breakdown_text.line(report)).toContain(
			'; test:related 2 over cap, in 1 of 1 runs; waits taken out',
		)
		read.mockRestore()
	})
})

// joshuafolkken/kit#5295: the followup line names the check its CI wait waited on last.
describe('lane_breakdown_text — the followup critical path', () => {
	it('writes the last check to settle on the ship followup line', () => {
		const read = vi.spyOn(lane_breakdown_implement, 'read').mockReturnValue([])
		const ci_wait: StageEntry = {
			kind: 'stage',
			at: AT,
			stage: 'ci-wait',
			elapsed_ms: 3 * MINUTE_MS,
			issue: ISSUE,
			last_check: 'e2e',
			check_ms: { e2e: 150_000, lint: 30_000 },
		}
		const breakdown = {
			...REPORT.breakdown,
			stages: [{ name: 'ship followup', ms: 4 * MINUTE_MS }],
		}

		const report = lane_breakdown_text.report_of(ISSUE, breakdown, [ci_wait])

		expect(lane_breakdown_text.line(report)).toContain(
			'ship followup 4.0 min (last check: e2e 150.0s)',
		)
		read.mockRestore()
	})
})

// joshuafolkken/kit#5294: the laps the ship wrote are read off the ledger into the report.
describe('lane_breakdown_text.report_of — ship laps', () => {
	it("reads the lane's ship laps off the ledger under the stage they ended in", () => {
		const read = vi.spyOn(lane_breakdown_implement, 'read').mockReturnValue([])
		const lap: ShipLapEntry = {
			kind: 'ship-lap',
			at: AT,
			issue: ISSUE,
			stage: 'gate',
			step: 'josh gate',
			elapsed_ms: 2 * MINUTE_MS,
		}
		const to_ms = Date.parse(AT)
		const breakdown = {
			...REPORT.breakdown,
			stages: [{ name: 'ship gate', ms: 3 * MINUTE_MS }],
			ship: [{ stage: 'ship gate', from_ms: to_ms - 3 * MINUTE_MS, to_ms }],
		}

		const report = lane_breakdown_text.report_of(ISSUE, breakdown, [lap])

		expect(lane_breakdown_text.line(report)).toContain('ship gate 3.0 min [josh gate 2.0 min]')
		read.mockRestore()
	})
})

// joshuafolkken/kit#5563: a stage past its share of a 30-minute lane says by how much; one within it
// carries nothing.
function report_with(stages: Report['breakdown']['stages']): Report {
	return { ...REPORT, breakdown: { ...REPORT.breakdown, stages } }
}

describe('lane_breakdown_text — stage budget', () => {
	it('writes the minutes an implement of 20 min ran past its budget', () => {
		const report = report_with([{ name: 'implement', ms: 20 * MINUTE_MS }])

		expect(lane_breakdown_text.line(report)).toContain(': implement 20.0 min, over budget +8 min (')
	})

	it('writes nothing beside a stage within its budget', () => {
		const report = report_with([
			{ name: lane_breakdown.PLAN_STAGE, ms: 3 * MINUTE_MS },
			{ name: 'ship gate', ms: 9 * MINUTE_MS },
			{ name: lane_breakdown.FOLLOWUP_STAGE, ms: 5 * MINUTE_MS },
		])

		expect(lane_breakdown_text.line(report)).not.toContain('over budget')
	})

	it('checks the ship followup against its own budget, not the ship one', () => {
		const report = report_with([{ name: lane_breakdown.FOLLOWUP_STAGE, ms: 6 * MINUTE_MS }])

		expect(lane_breakdown_text.line(report)).toContain(
			': ship followup 6.0 min, over budget +1 min',
		)
	})

	it('checks a ship stage against the whole ship budget', () => {
		const report = report_with([{ name: 'ship gate', ms: 11 * MINUTE_MS }])

		expect(lane_breakdown_text.line(report)).toContain(': ship gate 11.0 min, over budget +1 min;')
	})
})
