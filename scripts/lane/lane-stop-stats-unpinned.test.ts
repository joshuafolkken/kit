import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_ledger_schema } from './lane-ledger-schema'
import type { UnpinnedStop } from './lane-ledger-schema-ship'
import { lane_stats } from './lane-stats'
import { lane_stop_stats } from './lane-stop-stats'

// joshuafolkken/kit#7552: an `unpinned` preflight stop counts under the path it took, so which path to
// fix next is a number; one recorded before it had the path still counts under `unpinned`.

const NOW = Date.parse('2026-11-15T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const PREFLIGHT = 'preflight'
const UNPINNED = 'unpinned'
const AT = new Date(NOW - 10_000).toISOString()
const CAUSES_COLUMN = 7

function unpinned_stop(unpinned?: UnpinnedStop): LedgerEntry {
	return {
		kind: 'stop',
		at: AT,
		issue: 7552,
		reason: PREFLIGHT,
		cause: 'check',
		preconditions: [UNPINNED],
		...(unpinned !== undefined && { unpinned }),
	}
}

function causes_of(entries: ReadonlyArray<LedgerEntry>): string | undefined {
	const row = lane_stop_stats
		.table(entries, WINDOW)
		.split('\n')
		.map((line) => line.slice(2, -2).split(' | '))
		.find((cells) => cells[0] === PREFLIGHT)

	return row?.[CAUSES_COLUMN - 1]
}

describe('lane_stop_stats.table — the path an unpinned stop took', () => {
	it('counts each unpinned stop under its path', () => {
		const entries = [
			unpinned_stop({ path: 'no-reason', hunks: 2 }),
			unpinned_stop({ path: 'no-reason', hunks: 1 }),
			unpinned_stop({ path: 'no-reason', hunks: 4 }),
			unpinned_stop({ path: 'truncated', hunks: 1 }),
			unpinned_stop({ path: 'new-site', hunks: 3 }),
		]

		expect(causes_of(entries)).toBe(
			'unpinned:no-reason 3, unpinned:truncated 1, unpinned:new-site 1',
		)
	})

	it('counts a stop recorded before it had the path under unpinned', () => {
		const entries = [unpinned_stop(), unpinned_stop({ path: 'new-site', hunks: 1 })]

		expect(causes_of(entries)).toBe('unpinned 1, unpinned:new-site 1')
	})

	it('reads a stop line recorded before it had the path', () => {
		const line = { kind: 'stop', at: AT, issue: 7552, reason: PREFLIGHT, preconditions: [UNPINNED] }

		expect(lane_ledger_schema.entry_schema.safeParse(line).success).toBe(true)
	})
})
