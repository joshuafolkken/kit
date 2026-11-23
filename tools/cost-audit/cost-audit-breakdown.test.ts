import { lane_breakdown } from '#scripts/lane/lane-breakdown'
import type { LedgerEntry } from '#scripts/lane/lane-ledger'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { cost_audit_breakdown } from './cost-audit-breakdown'

// joshuafolkken/kit#8757: each Issue's breakdown built from the records it reaches equals the one the
// whole history gives — other Issues' noise, a yield to a holder, a host event and an entry naming no
// Issue included.

const ISSUE = 4970
const HOLDER = 4971
const OTHER = 4972
const MINUTE_MS = 60_000
const SHIP_STAGE = 'ship-stage'
const START = Date.parse('2026-10-26T05:43:00.000Z')

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function event(minute: number, kind: string, text: string): RunEvent {
	return { pos: minute, at: at(minute), kind, text }
}

function lane_of(issue: number, from: number, to: number): Array<LedgerEntry> {
	return [
		{ kind: 'dispatch', at: at(from), issue },
		{ kind: 'merge', at: at(to), issue },
	]
}

const ENTRIES: ReadonlyArray<LedgerEntry> = [
	...lane_of(ISSUE, 0, 80),
	{
		kind: 'startup',
		at: at(1),
		run: 'r1',
		attempt: 'a1',
		id: 'i1',
		phase: 'load',
		edge: 'start',
		issue: String(ISSUE),
	},
	...lane_of(HOLDER, 5, 40),
	...lane_of(OTHER, 10, 30),
]

const EVENTS: ReadonlyArray<RunEvent> = [
	event(10, 'plan', `#${String(ISSUE)} plan`),
	event(11, 'plan', `#${String(OTHER)} plan`),
	event(12, 'lane-phase', `#${String(ISSUE)} implement`),
	event(20, 'yield', `#${String(ISSUE)} yields to #${String(HOLDER)}`),
	event(25, 'sleep', 'host asleep'),
	event(28, 'wake', 'host awake'),
	event(35, 'done', `#${String(HOLDER)} done`),
	event(36, 'sleep', `#${String(OTHER)} host asleep`),
	event(61, SHIP_STAGE, `#${String(ISSUE)} review start`),
	event(71, SHIP_STAGE, `#${String(ISSUE)} review done`),
]

describe('cost_audit_breakdown.of_issues — the partition gives the full-history breakdown', () => {
	it('equals lane_breakdown.of over the whole ledger and stream for every Issue', () => {
		const issues = [ISSUE, HOLDER, OTHER]
		const partitioned = cost_audit_breakdown.of_issues(issues, ENTRIES, EVENTS)
		const full = issues.flatMap((issue) => {
			const one = lane_breakdown.of(ENTRIES, EVENTS, issue)

			return one === undefined ? [] : [[issue, one] as const]
		})

		expect(partitioned).toStrictEqual(new Map(full))
		expect(partitioned.size).toBe(issues.length)
	})

	it('gives no breakdown to an Issue the ledger holds no dispatch and merge of', () => {
		expect(cost_audit_breakdown.of_issues([1], ENTRIES, EVENTS).size).toBe(0)
	})
})
