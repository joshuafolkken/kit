import { describe, expect, it } from 'vitest'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import type { LedgerEntry } from './lane-ledger'
import type { SinkRecords } from './lane-sinks'
import { lane_why_period } from './lane-why-period'

// #6475: period-wide evidence groups reuse lane:why budgets and count each lane once per cause.
const MINUTE_MS = 60_000
const START = Date.parse('2026-11-05T00:00:00Z')
const WINDOW = { since_ms: START, until_ms: START + 120 * MINUTE_MS }
const ISSUE = 6475
const { CAUSE } = lane_why_period

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
	it('uses shared budgets and keeps implement attribution uncertain', () => {
		const breakdown = breakdown_of(['implement', 'ship gate'], 40 * MINUTE_MS)

		expect([...lane_why_period.causes_of(breakdown, []).keys()]).toStrictEqual([
			CAUSE.IMPLEMENT,
			CAUSE.OTHER,
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
			...breakdown_of(['ship gate', 'ship review']),
			pauses: [{ at_ms: START, name: 'pause for #12' }],
		}
		const causes = lane_why_period.causes_of(breakdown, ['scripts/a.ts'])

		expect([...causes.keys()]).toStrictEqual([CAUSE.OTHER, CAUSE.PAUSE, CAUSE.HUB])
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
			'| other | 2 | 110.0 | #6474 |',
		)
	})

	it('counts net minutes and keeps multiple signals separate', () => {
		const records: SinkRecords = {
			entries: [...entries_of(ISSUE, 90), { kind: 'dispatch', issue: ISSUE, at: at(50) }],
			events: [
				{ pos: 0, kind: 'plan', at: at(10), text: '#6475 plan' },
				{ pos: 1, kind: 'park', at: at(30), text: '#6475 parked (review)' },
				{ pos: 2, kind: 'setup', at: at(50), text: 'opening lane #6475' },
			],
		}
		const table = lane_why_period.table(records, WINDOW, 40, [])

		expect(table).toContain(`| ${CAUSE.IMPLEMENT} | 1 | 70.0 | none |`)
		expect(table).toContain('| pause | 1 | 70.0 | none |')
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
