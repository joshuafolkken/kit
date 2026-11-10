import { describe, expect, it } from 'vitest'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import { lane_implement_signals } from './lane-implement-signals'
import type { LedgerEntry } from './lane-ledger'
import type { SinkRecords } from './lane-sinks'
import { lane_why_period } from './lane-why-period'

// #6475: period-wide evidence groups reuse lane:why budgets and count each lane once per cause.
const MINUTE_MS = 60_000
const START = Date.parse('2026-11-05T00:00:00Z')
const WINDOW = { since_ms: START, until_ms: START + 120 * MINUTE_MS }
const ISSUE = 6475
const { CAUSE } = lane_why_period
const SHIP_STAGES = ['ship gate', 'ship review']
const PLAN_TEXT = '#6475 plan'

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function entries_of(issue: number, minutes: number): Array<LedgerEntry> {
	return [
		{ kind: 'dispatch', issue, at: at(0) },
		{ kind: 'merge', issue, at: at(minutes) },
	]
}

function breakdown_of(names: ReadonlyArray<string>, followup_ms = 0): Breakdown {
	const breakdown = lane_breakdown.of(entries_of(ISSUE, 60), [], ISSUE)

	if (breakdown === undefined) throw new Error('fixture lane missing')

	const stages = names.map((name) => ({ name, ms: 40 * MINUTE_MS }))
	const driver = [{ name: lane_breakdown.DRIVER_FOLLOWUP_STAGE, ms: followup_ms }]

	return { ...breakdown, stages, driver }
}

describe('lane_why_period.causes_of', () => {
	it('uses shared budgets and keeps implement attribution uncertain without signals', () => {
		const breakdown = breakdown_of(['implement', 'ship gate'], 40 * MINUTE_MS)

		expect([...lane_why_period.causes_of(breakdown, []).keys()]).toStrictEqual([
			CAUSE.IMPLEMENT,
			'ship',
			CAUSE.DRIVER,
		])
		expect(CAUSE.IMPLEMENT).toContain('unverified')
	})

	// joshuafolkken/kit#6541: the driver's followup explains none of the lane's net time.
	it('adds other beside a driver followup over budget that is the only signal', () => {
		const breakdown = breakdown_of([], 40 * MINUTE_MS)

		expect([...lane_why_period.causes_of(breakdown, []).keys()]).toStrictEqual([
			CAUSE.DRIVER,
			CAUSE.OTHER,
		])
	})

	it('groups repeated stages once and names pause and hub evidence independently', () => {
		const breakdown = {
			...breakdown_of(SHIP_STAGES),
			pauses: [{ at_ms: START, name: 'pause for #12' }],
		}
		const causes = lane_why_period.causes_of(breakdown, ['scripts/a.ts'])

		expect([...causes.keys()]).toStrictEqual(['ship', CAUSE.PAUSE, CAUSE.HUB])
		expect(causes.get('ship')).toStrictEqual(SHIP_STAGES)
		expect(causes.get(CAUSE.HUB)).toStrictEqual(['a.ts'])
	})

	it('falls back to other without over-budget evidence', () => {
		expect([...lane_why_period.causes_of(breakdown_of([]), []).keys()]).toStrictEqual([CAUSE.OTHER])
	})
})

describe('lane_why_period.table', () => {
	it('filters by merge window and strict net threshold, deduplicates lanes and issue links', () => {
		const records: SinkRecords = {
			entries: [
				...entries_of(ISSUE, 60),
				...entries_of(ISSUE + 1, 50),
				...entries_of(ISSUE + 2, 40),
				...entries_of(ISSUE + 3, 121),
			],
			events: [],
		}
		const issues = [{ number: 6474, title: 'Shorten start to plan' }]

		expect(lane_why_period.table(records, WINDOW, 40, issues).split('\n').at(-1)).toBe(
			'| plan | 2 | 110.0 | #6474 |',
		)
	})

	it('counts net minutes and keeps multiple signals separate', () => {
		const records: SinkRecords = {
			entries: [...entries_of(ISSUE, 90), { kind: 'dispatch', issue: ISSUE, at: at(50) }],
			events: [
				{ pos: 0, kind: 'plan', at: at(10), text: PLAN_TEXT },
				{ pos: 1, kind: 'park', at: at(30), text: '#6475 parked (review)' },
				{ pos: 2, kind: 'setup', at: at(50), text: 'opening lane #6475' },
			],
		}
		const table = lane_why_period.table(records, WINDOW, 40, [])

		expect(table).toContain(`| ${CAUSE.IMPLEMENT} | 1 | 70.0 | none |`)
		expect(table).toContain('| pause | 1 | 70.0 | none |')
	})
})

// joshuafolkken/kit#6952: the driver row is linked by the lane's cause keys, not only its stage name.
describe('lane_why_period — driver cause keys', () => {
	const SONAR_ISSUE = { number: 5085, title: 'Check whether the SonarJasmin taint engine changed' }

	it('adds the driver keys to the driver followup group only', () => {
		const causes = lane_why_period.causes_of(breakdown_of(['implement'], 40 * MINUTE_MS), [], {
			ship: ['k'],
		})

		expect(causes.get(CAUSE.DRIVER)).toStrictEqual(['driver followup', 'k'])
		expect(causes.get(CAUSE.IMPLEMENT)).toStrictEqual(['implement'])
	})

	// #6537: its followup settled last on SonarQube, which #5085 names.
	it('links the driver followup row to the Issue its longest CI check names', () => {
		const records: SinkRecords = {
			entries: [
				...entries_of(ISSUE, 60),
				{
					kind: 'stage',
					at: at(59),
					stage: 'ci-wait',
					elapsed_ms: 200_000,
					issue: ISSUE,
					last_check: 'SonarCloud Code Analysis',
					check_ms: { 'SonarCloud Code Analysis': 157_000 },
				},
			],
			events: [{ pos: 0, kind: 'ship-stage', at: at(45), text: '#6475 followup start' }],
		}
		const table = lane_why_period.table(records, WINDOW, 40, [SONAR_ISSUE])

		expect(table).toContain(`| ${CAUSE.DRIVER} | 1 | 45.0 | #5085 |`)
	})
})

// joshuafolkken/kit#6988: implement and other overruns split into a row per cause key.
describe('lane_why_period — cause key rows', () => {
	const EDITED = 'edited files'
	const IMPLEMENT = [lane_breakdown.IMPLEMENT_STAGE]

	it('splits an implement overrun by its signal keys, each linked by its key', () => {
		const causes = lane_why_period.causes_of(breakdown_of(IMPLEMENT), [], {
			ship: [],
			implement: [EDITED, 'plan divergence'],
		})

		expect([...causes.keys()]).toStrictEqual([`implement: ${EDITED}`, 'implement: plan divergence'])
		expect(causes.get(`implement: ${EDITED}`)).toStrictEqual([EDITED])
	})

	it('names an implement overrun whose signals passed no bar apart from an unrecorded one', () => {
		const causes = lane_why_period.causes_of(breakdown_of(IMPLEMENT), [], {
			ship: [],
			implement: [],
		})

		expect([...causes.keys()]).toStrictEqual([CAUSE.IMPLEMENT_CLEAR])
	})

	it('splits a ship overrun by its ship keys and names a plan overrun by its budget', () => {
		const breakdown = breakdown_of([lane_breakdown.PLAN_STAGE, 'ship gate'])
		const causes = lane_why_period.causes_of(breakdown, [], { ship: ['sonarqube'] })

		expect([...causes.keys()]).toStrictEqual(['plan', 'ship: sonarqube'])
	})
})

describe('lane_why_period.table — recorded implement signals', () => {
	it('reads the lane recorded signals into the period table', () => {
		const signals = { edits: 12, test_related: 0, lint_related: 0, investigations: 0, unplanned: 0 }
		const records: SinkRecords = {
			entries: entries_of(ISSUE, 60),
			events: [
				{ pos: 0, kind: 'plan', at: at(10), text: PLAN_TEXT },
				{
					pos: 1,
					kind: lane_implement_signals.KIND,
					at: at(50),
					text: lane_implement_signals.text_of(String(ISSUE), signals),
				},
			],
		}
		const table = lane_why_period.table(records, WINDOW, 40, [])

		expect(table).toContain('| implement: edited files | 1 |')
		expect(table).not.toContain(CAUSE.IMPLEMENT)
	})
})

describe('lane_why_period.table — missing records', () => {
	it('distinguishes an unread listing from no matches and an empty period', () => {
		const records = { entries: entries_of(ISSUE, 60), events: [] }

		expect(lane_why_period.table(records, WINDOW, 40, undefined)).toContain('| unread |')
		expect(lane_why_period.table(records, WINDOW, 40, [])).toContain('| none |')
		expect(
			lane_why_period.table({ entries: [], events: [] }, WINDOW, 40, []).split('\n'),
		).toHaveLength(2)
	})
})
