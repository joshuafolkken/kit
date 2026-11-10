import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { lane_chain_stop_stats } from './lane-chain-stop-stats'
import type { LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#7024: one ledger period reduces to a row per `run:chain` stop cause — how often
// the chain stopped there and how long until the next run on that issue started.

const NOW = Date.parse('2026-11-10T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const CHECK_RELATED = 'check:related'
const RUN_REVIEW = 'run:review'
const RUN_MINUTES = 4

interface Run {
	issue: number
	ended_before: number
	stage?: string
	reason?: 'exit' | 'hold'
	join?: boolean
}

function minutes_before_now(minutes: number): string {
	return new Date(NOW - minutes * MS_PER_MINUTE).toISOString()
}

// A run of `RUN_MINUTES` that ended `ended_before` minutes before now.
function chain(run: Run): LedgerEntry {
	return {
		kind: 'chain',
		at: minutes_before_now(run.ended_before),
		issue: run.issue,
		elapsed_ms: RUN_MINUTES * MS_PER_MINUTE,
		join: run.join ?? false,
		...(run.stage !== undefined && { stage: run.stage }),
		...(run.reason !== undefined && { reason: run.reason }),
	}
}

function rows_of(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	return lane_chain_stop_stats.table(entries, WINDOW).split('\n').slice(2)
}

describe('lane_chain_stop_stats.table', () => {
	it('counts each cause and sums the minutes until the next run on the same issue started', () => {
		const entries = [
			chain({ issue: 1, ended_before: 60, stage: CHECK_RELATED, reason: 'exit' }),
			chain({ issue: 2, ended_before: 58, stage: CHECK_RELATED, reason: 'exit' }),
			chain({ issue: 1, ended_before: 44 }),
			chain({ issue: 2, ended_before: 30 }),
		]

		expect(rows_of(entries)).toStrictEqual(['| check:related (exit) | 2 | 36.0 | 18.0 | 0 |'])
	})

	it('counts a stop no run followed as not re-run, kept out of the minutes', () => {
		const entries = [
			chain({ issue: 3, ended_before: 10, stage: RUN_REVIEW, reason: 'hold', join: true }),
		]

		expect(rows_of(entries)).toStrictEqual([
			'| run:review --join (hold) | 1 | not measured | not measured | 1 |',
		])
	})
})

describe('lane_chain_stop_stats.table — row order', () => {
	it('leads with the cause that cost the most minutes', () => {
		const entries = [
			chain({ issue: 1, ended_before: 50, stage: RUN_REVIEW, reason: 'exit' }),
			chain({ issue: 1, ended_before: 40 }),
			chain({ issue: 2, ended_before: 50, stage: CHECK_RELATED, reason: 'exit' }),
			chain({ issue: 2, ended_before: 20 }),
		]

		expect(rows_of(entries).map((row) => row.split(' | ', 1)[0])).toStrictEqual([
			'| check:related (exit)',
			'| run:review (exit)',
		])
	})

	it('prints a none row when the period saw no stop', () => {
		expect(rows_of([chain({ issue: 1, ended_before: 5 })])).toStrictEqual([
			'| none | 0 | not measured | not measured | 0 |',
		])
	})
})
