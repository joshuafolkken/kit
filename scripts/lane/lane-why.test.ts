import type { TimingAnswer } from '#scripts/ci/ci-timing'
import { describe, expect, it } from 'vitest'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import { lane_implement_signals } from './lane-implement-signals'
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
		events: [],
		breakdown: breakdown_of(),
		projected: PROJECTED,
		issues: [{ number: 6124, title: 'Speed up the implement stage' }],
		timing: undefined,
		log: undefined,
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
				'| stage | min | budget | projected | CI | ship | causes | open issues | unfiled |',
				'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
				'| implement | 51.0 min | 9 min | 20.3 min |  |  |  | #6124 |  |',
				'| start to plan | 10.0 min | 3 min |  |  |  |  | none |  |',
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

	it('leaves the cells of missing records blank and marks an unread listing', () => {
		const records = records_of({ projected: undefined, issues: undefined })

		expect(lane_why.table(records)?.split('\n', 3)[2]).toBe(
			'| implement | 51.0 min | 9 min |  |  |  |  | unread |  |',
		)
	})

	it('answers undefined when no stage ran over its budget', () => {
		const breakdown = { ...breakdown_of(), stages: [{ name: 'implement', ms: MINUTE_MS }] }

		expect(lane_why.table(records_of({ breakdown }))).toBeUndefined()
	})
})

// joshuafolkken/kit#6679: a ship row's open Issues name its cause keys, not its stage.
describe('lane_why.table ship cause cells', () => {
	const log = [
		'PR checks failed (failed checks: SonarQube Cloud Code Analysis, e2e).',
		'🔀 Not rerunning: main changed the failed tests since the branch point (a.ts); merge main first.',
	].join('\n')
	const issues = [{ number: 5085, title: 'Check whether the SonarJasmin JS/TS taint engine ...' }]

	it('lists the cause keys, the open Issues they name and the keys none names', () => {
		const entries = [...LANE, ...SHIP_ROWS]
		const breakdown = with_stages([SHIP_STAGE])
		const rows = lane_why.table(records_of({ entries, breakdown, issues, log }))?.split('\n')

		expect(rows?.[2]).toContain('| sonarqube, e2e, main move | #5085 | e2e, main move |')
	})

	it('answers none for a ship row with no cause key', () => {
		const rows = lane_why.table(records_of({ breakdown: with_stages([SHIP_STAGE]) }))?.split('\n')

		expect(rows?.[2]).toContain('|  | none |  |')
	})
})

// joshuafolkken/kit#6983: an implement row's causes are the keys of its recorded signals.
describe('lane_why.table implement cause cells', () => {
	const signals = { edits: 2, test_related: 4, lint_related: 0, investigations: 1, unplanned: 1 }
	const text = lane_implement_signals.text_of(String(ISSUE), signals)
	const events = [{ pos: 2, at: at(30), kind: lane_implement_signals.KIND, text }]
	const issues = [{ number: 7001, title: 'Cut test:related reruns in lanes' }]

	it('lists the implement cause keys, the open Issues they name and the keys none names', () => {
		const rows = lane_why.table(records_of({ events, issues }))?.split('\n')

		expect(rows?.[2]).toBe(
			'| implement | 51.0 min | 9 min | 20.3 min |  |  | plan divergence, test:related reruns | #7001 | plan divergence |',
		)
	})

	it('falls back to the Issues naming the stage when no signal passed its bar', () => {
		const quiet = { edits: 1, test_related: 1, lint_related: 0, investigations: 0, unplanned: 0 }
		const quiet_text = lane_implement_signals.text_of(String(ISSUE), quiet)
		const quiet_events = [
			{ pos: 2, at: at(30), kind: lane_implement_signals.KIND, text: quiet_text },
		]

		expect(lane_why.table(records_of({ events: quiet_events }))).toBe(lane_why.table(records_of()))
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
