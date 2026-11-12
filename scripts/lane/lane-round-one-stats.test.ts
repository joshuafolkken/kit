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
const NO_SKIPPED = '| skipped | 0 | - |'
const FIXED_QUARTER = '| fixed | 1 | 25% |'
const NO_REVIEWED = ['| clean | 0 | - |', '| fixed | 0 | - |', '| blocking | 0 | - |']

function rows_of(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	return lane_round_one_stats.table(entries, WINDOW).split('\n').slice(2)
}

describe('lane_round_one_stats.table', () => {
	it('counts each verdict with its share of the rounds that ran, reused without one', () => {
		const verdicts = ['clean', 'clean', 'fixed', 'clean', 'reused']

		expect(rows_of(verdicts.map((verdict) => round(verdict)))).toStrictEqual([
			'| clean | 3 | 75% |',
			FIXED_QUARTER,
			'| blocking | 0 | 0% |',
			'| reused | 1 | - |',
			NO_SKIPPED,
		])
	})

	it('counts only the rounds inside the period, and no other kind of entry', () => {
		const merge: LedgerEntry = { kind: 'merge', at: new Date(NOW).toISOString(), issue: 1 }
		const outside = ['fixed', 'skipped'].map((verdict) => round(verdict, OUTSIDE_MINUTES))

		expect(rows_of([...outside, merge, round('blocking')])).toStrictEqual([
			'| clean | 0 | 0% |',
			'| fixed | 0 | 0% |',
			'| blocking | 1 | 100% |',
			NO_REUSE,
			NO_SKIPPED,
		])
	})

	it('prints zero rows with no share when the period saw no round', () => {
		expect(lane_round_one_stats.table([], WINDOW).split('\n')).toStrictEqual([
			'| round 1 | rounds | share |',
			'| --- | --- | --- |',
			...NO_REVIEWED,
			NO_REUSE,
			NO_SKIPPED,
		])
	})
})

describe('lane_round_one_stats.table skipped rounds', () => {
	it('counts skipped rounds without changing reviewed shares (ac-4d157a66) (ac-9e2de459)', () => {
		const verdicts = ['clean', 'clean', 'fixed', 'blocking', 'skipped', 'skipped']

		expect(rows_of(verdicts.map((verdict) => round(verdict)))).toStrictEqual([
			'| clean | 2 | 50% |',
			FIXED_QUARTER,
			'| blocking | 1 | 25% |',
			NO_REUSE,
			'| skipped | 2 | - |',
		])
	})

	it('counts skipped-only periods without assigning shares (ac-9fa25465)', () => {
		expect(rows_of([round('skipped')])).toStrictEqual([
			...NO_REVIEWED,
			NO_REUSE,
			'| skipped | 1 | - |',
		])
	})
})
