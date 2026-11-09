import type { TimingAnswer } from '#scripts/ci/ci-timing'
import { describe, expect, it } from 'vitest'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import type { LedgerEntry } from './lane-ledger'
import { lane_why, type WhyRecords } from './lane-why'

// joshuafolkken/kit#6120: `josh lane:why` joins a lane's stages over budget with the records that say
// why, each cell blank where its record is missing.

const ISSUE = 6050
const START = Date.parse('2026-11-03T05:00:00.000Z')
const MINUTE_MS = 60_000
const PROJECTED = 20.25
const SHIP_STAGE = 'ship review'
const RUN = { id: 1, head_sha: 'abc', html_url: 'https://example.test/run/1' }
const TIMED_ROW = { name: 'e2e', seconds: 300, conclusion: 'success' }

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

const LANE: ReadonlyArray<LedgerEntry> = [
	{ kind: 'dispatch', at: at(0), issue: ISSUE },
	{ kind: 'merge', at: at(61), issue: ISSUE },
]

const SHIP_ROWS: ReadonlyArray<LedgerEntry> = [
	{
		kind: 'stage',
		at: at(60),
		stage: 'ci-wait',
		elapsed_ms: MINUTE_MS,
		issue: ISSUE,
		last_check: 'e2e',
		check_ms: { e2e: 150_000 },
	},
	{ kind: 'stop', at: at(50), issue: ISSUE, reason: 'gate' },
	{ kind: 'stop', at: at(50), issue: ISSUE + 1, reason: 'gate' },
	{
		kind: 'test-related',
		at: at(40),
		issue: ISSUE,
		scope: 'related',
		changed: 3,
		synced: 3,
		since_map: 0,
		readers: 1,
		elapsed_ms: MINUTE_MS,
		over_cap: 2,
	},
]

function breakdown_of(): Breakdown {
	const events = [{ pos: 1, at: at(10), kind: 'plan', text: `#${String(ISSUE)} plan` }] as const
	const breakdown = lane_breakdown.of(LANE, events, ISSUE)

	if (breakdown === undefined) throw new Error('the fixture lane has no breakdown')

	return breakdown
}

function records_of(overrides: Partial<WhyRecords> = {}): WhyRecords {
	return {
		issue: ISSUE,
		entries: LANE,
		breakdown: breakdown_of(),
		projected: PROJECTED,
		issues: [{ number: 6124, title: 'Speed up the implement stage' }],
		timing: undefined,
		...overrides,
	}
}

function with_stages(names: ReadonlyArray<string>, followup_ms = 0): Breakdown {
	const driver =
		followup_ms > 0 ? [{ name: lane_breakdown.DRIVER_FOLLOWUP_STAGE, ms: followup_ms }] : []

	return { ...breakdown_of(), stages: names.map((name) => ({ name, ms: 40 * MINUTE_MS })), driver }
}

describe('lane_why.table', () => {
	it('builds one row per stage over budget from the fixture records', () => {
		expect(lane_why.table(records_of())).toBe(
			[
				'| stage | min | budget | projected | CI | ship | open issues |',
				'| --- | --- | --- | --- | --- | --- | --- |',
				'| implement | 51.0 min | 9 min | 20.3 min |  |  | #6124 |',
				'| start to plan | 10.0 min | 3 min |  |  |  | none |',
			].join('\n'),
		)
	})

	// joshuafolkken/kit#6541: the driver's followup, outside the net time, follows the lane's stages.
	it('fills the driver followup row with the last check and a ship row with its stops', () => {
		const entries = [...LANE, ...SHIP_ROWS]
		const breakdown = with_stages([SHIP_STAGE], 40 * MINUTE_MS)
		const rows = lane_why.table(records_of({ entries, breakdown }))?.split('\n')

		expect(rows?.[2]).toContain('|  | gate; test:related 2 over cap, in 1 of 1 runs |')
		expect(rows?.[3]).toContain('| driver followup | 40.0 min |')
		expect(rows?.[3]).toContain('| (last check: e2e 150.0s) |  |')
	})

	it('leaves the cells of missing records blank', () => {
		const records = records_of({ projected: undefined, issues: undefined })

		expect(lane_why.table(records)?.split('\n', 3)[2]).toBe(
			'| implement | 51.0 min | 9 min |  |  |  |  |',
		)
	})

	it('answers undefined when no stage ran over its budget', () => {
		const breakdown = { ...breakdown_of(), stages: [{ name: 'implement', ms: MINUTE_MS }] }

		expect(lane_why.table(records_of({ breakdown }))).toBeUndefined()
	})
})

describe('lane_why.table followup CI cell', () => {
	it('adds the longest CI job and step after the last check', () => {
		const timing: TimingAnswer = {
			kind: 'timed',
			runs: [{ run: RUN, jobs: [{ ...TIMED_ROW, steps: [{ ...TIMED_ROW, name: 'playwright' }] }] }],
		}
		const entries = [...LANE, ...SHIP_ROWS]
		const breakdown = with_stages([], 40 * MINUTE_MS)
		const rows = lane_why.table(records_of({ entries, breakdown, timing }))?.split('\n')

		expect(rows?.[2]).toContain(
			'| (last check: e2e 150.0s); longest job: e2e 300s, step: playwright 300s |',
		)
	})
})

describe('lane_why.projected_of', () => {
	const rate = { median: 10, lanes: 3 }
	const body = '## 背景\n\n- 規模見積もり: 約 6 ファイル / 100 行（テスト除く）\n'

	it('projects the grown declared lines at the measured rate', () => {
		expect(lane_why.projected_of(body, rate)).toBeCloseTo(20)
	})

	it('projects with the measured lines ratio independently of files', () => {
		expect(lane_why.projected_of(body, rate, { files: 3, lines: 1.5 })).toBeCloseTo(15)
	})

	it('answers undefined with no body, no estimate or no rate', () => {
		expect(lane_why.projected_of(undefined, rate)).toBeUndefined()
		expect(lane_why.projected_of('## 背景\n\nno estimate\n', rate)).toBeUndefined()
		expect(lane_why.projected_of(body, undefined)).toBeUndefined()
	})
})
