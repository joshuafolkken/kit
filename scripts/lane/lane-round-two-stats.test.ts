import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_round_two_stats } from './lane-round-two-stats'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#4064: one ledger period reduces to a row per round-2 verdict and reason code, so
// the period's runs and skips are counted by why.

const NOW = Date.parse('2026-10-18T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const MS_PER_MINUTE = 60_000
const OUTSIDE_MINUTES = 2 * 24 * 60

function decision(verdict: string, code: string, minutes_before = 10): LedgerEntry {
	const at = new Date(NOW - minutes_before * MS_PER_MINUTE).toISOString()

	return { kind: 'round-two', at, issue: 1, verdict, code }
}

function rows_of(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	return lane_round_two_stats.table(entries, WINDOW).split('\n').slice(2)
}

describe('lane_round_two_stats.table', () => {
	it('counts each verdict and code pair, the most frequent first', () => {
		const entries = [
			decision('required', 'live'),
			decision('skip', 'empty'),
			decision('skip', 'empty'),
			decision('required', 'open-finding'),
			decision('skip', 'empty'),
		]

		expect(rows_of(entries)).toStrictEqual([
			'| skip | empty | 3 |',
			'| required | live | 1 |',
			'| required | open-finding | 1 |',
		])
	})

	it('counts only the decisions inside the period, and no other kind of entry', () => {
		const merge: LedgerEntry = { kind: 'merge', at: new Date(NOW).toISOString(), issue: 1 }
		const entries = [decision('skip', 'inert', OUTSIDE_MINUTES), merge, decision('skip', 'inert')]

		expect(rows_of(entries)).toStrictEqual(['| skip | inert | 1 |'])
	})

	it('prints a none row under the header when the period saw no decision', () => {
		expect(lane_round_two_stats.table([], WINDOW).split('\n')).toStrictEqual([
			'| round 2 | code | decisions |',
			'| --- | --- | --- |',
			'| none | none | 0 |',
		])
	})
})
