import { describe, expect, it } from 'vitest'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import type { LedgerEntry, ShipLapEntry, TestRelatedEntry } from './lane-ledger'
import { lane_why_ship } from './lane-why-ship'

// joshuafolkken/kit#6154: `josh lane:why`'s ship total sums the scoped pair's runs, the core-budget
// waits and the `test:related` cap overrun over the whole ship, each cell blank where its record is
// missing.

const ISSUE = 6120
const START = Date.parse('2026-11-03T05:00:00.000Z')
const MINUTE_MS = 60_000

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

const LANE: ReadonlyArray<LedgerEntry> = [
	{ kind: 'dispatch', at: at(0), issue: ISSUE },
	{ kind: 'merge', at: at(61), issue: ISSUE },
]

function lap(minute: number, elapsed_minutes: number, rerun?: string): ShipLapEntry {
	return {
		kind: 'ship-lap',
		at: at(minute),
		issue: ISSUE,
		stage: 'gate',
		step: 'scoped pair',
		elapsed_ms: elapsed_minutes * MINUTE_MS,
		...(rerun !== undefined && { runs: 2, rerun }),
	}
}

const RELATED: TestRelatedEntry = {
	kind: 'test-related',
	at: at(42),
	issue: ISSUE,
	scope: 'related',
	changed: 3,
	synced: 3,
	since_map: 0,
	readers: 1,
	elapsed_ms: MINUTE_MS,
	over_cap: 2,
	over_cap_hub: 'scripts/lane/lane-ledger.ts',
}

const SHIP_ROWS: ReadonlyArray<LedgerEntry> = [
	lap(40, 3),
	lap(45, 2, 'edited'),
	{ ...lap(46, 9), issue: ISSUE + 1 },
	{ kind: 'core-wait', at: at(44), command: 'gate', waited_ms: 2 * MINUTE_MS, issue: ISSUE },
	{ kind: 'core-wait', at: at(47), command: 'gate', waited_ms: MINUTE_MS, issue: ISSUE },
	// Before the ship: no part of its total.
	{ kind: 'core-wait', at: at(20), command: 'gate', waited_ms: 5 * MINUTE_MS, issue: ISSUE },
	{ ...RELATED, at: at(20), over_cap: 3 },
	RELATED,
]

function breakdown_of(): Breakdown {
	const events = [{ pos: 1, at: at(10), kind: 'plan', text: `#${String(ISSUE)} plan` }] as const
	const breakdown = lane_breakdown.of(LANE, events, ISSUE)

	if (breakdown === undefined) throw new Error('the fixture lane has no breakdown')

	return {
		...breakdown,
		ship: [
			{ stage: 'ship gate', from_ms: START + 30 * MINUTE_MS, to_ms: START + 50 * MINUTE_MS },
			{
				stage: lane_breakdown.BETWEEN_STAGE,
				from_ms: START + 50 * MINUTE_MS,
				to_ms: START + 57 * MINUTE_MS,
			},
		],
	}
}

function lines_of(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	return lane_why_ship.table({ issue: ISSUE, entries, breakdown: breakdown_of() }).split('\n')
}

function row_of(entries: ReadonlyArray<LedgerEntry>): string | undefined {
	return lines_of(entries)[2]
}

describe('lane_why_ship.table', () => {
	it('prints the ship total with its scoped pair runs, core-budget waits and cap overrun', () => {
		const related = 'test:related 2 over cap, in 1 of 1 runs, hub scripts/lane/lane-ledger.ts'

		expect(lines_of([...LANE, ...SHIP_ROWS])).toStrictEqual([
			'| ship total | scoped pair | core-budget wait | test:related |',
			'| --- | --- | --- | --- |',
			`| 27.0 min | 2 runs, 5.0 min | 3.0 min | ${related} |`,
		])
	})

	it('leaves the cells blank where the ledger holds no lap, wait or test:related row', () => {
		expect(row_of(LANE)).toBe('| 27.0 min |  |  |  |')
	})
})
