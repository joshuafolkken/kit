import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_round_one_stats } from './lane-round-one-stats'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#4620: one ledger period reduces to a row per round-1 verdict, with the share of
// the rounds the ship ran — the clean share is the pass-without-fix rate.

const NOW = Date.parse('2026-10-23T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const OUTSIDE_MINUTES = 2 * 24 * 60

function round(verdict: string, minutes_before = 10): LedgerEntry {
	const at = new Date(NOW - minutes_before * MS_PER_MINUTE).toISOString()

	return { kind: 'round-one', at, issue: 1, verdict }
}

const NO_REUSE = '| reused | 0 | - |'

function rows_of(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	return lane_round_one_stats.table(entries, WINDOW).split('\n').slice(2)
}

describe('lane_round_one_stats.table', () => {
	it('counts each verdict with its share of the rounds that ran, reused without one', () => {
		const verdicts = ['clean', 'clean', 'fixed', 'clean', 'reused']

		expect(rows_of(verdicts.map((verdict) => round(verdict)))).toStrictEqual([
			'| clean | 3 | 75% |',
			'| fixed | 1 | 25% |',
			'| blocking | 0 | 0% |',
			'| reused | 1 | - |',
		])
	})

	it('counts only the rounds inside the period, and no other kind of entry', () => {
		const merge: LedgerEntry = { kind: 'merge', at: new Date(NOW).toISOString(), issue: 1 }

		expect(rows_of([round('fixed', OUTSIDE_MINUTES), merge, round('blocking')])).toStrictEqual([
			'| clean | 0 | 0% |',
			'| fixed | 0 | 0% |',
			'| blocking | 1 | 100% |',
			NO_REUSE,
		])
	})

	it('prints zero rows with no share when the period saw no round', () => {
		expect(lane_round_one_stats.table([], WINDOW).split('\n')).toStrictEqual([
			'| round 1 | rounds | share |',
			'| --- | --- | --- |',
			'| clean | 0 | - |',
			'| fixed | 0 | - |',
			'| blocking | 0 | - |',
			NO_REUSE,
		])
	})
})
