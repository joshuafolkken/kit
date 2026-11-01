import { issue_cite } from '#scripts/issue/issue-cite'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_cut_stats } from './lane-cut-stats'
import type { LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'

const NOW = Date.parse('2026-11-01T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const ISSUE = 5352
const OTHER = 5400
const QUIET = 5500
const OLD_MINUTES = 2 * 24 * 60

function minutes_before_now(minutes: number): string {
	return new Date(NOW - minutes * MS_PER_MINUTE).toISOString()
}

function cut(issue: number, phase: string, minutes_before = 10): RunEvent {
	return {
		pos: 1,
		at: minutes_before_now(minutes_before),
		kind: 'cut',
		text: `${issue_cite.plain(issue)} cut (${phase})`,
	}
}

function dispatch(issue: number): LedgerEntry {
	return { kind: 'dispatch', at: minutes_before_now(60), issue }
}

const EVENTS: ReadonlyArray<RunEvent> = [
	cut(ISSUE, 'implementation'),
	cut(ISSUE, 'implementation'),
	cut(ISSUE, 'pre-gate'),
	cut(OTHER, 'pre-gate'),
	{
		pos: 2,
		at: minutes_before_now(5),
		kind: 'park',
		text: `${issue_cite.plain(ISSUE)} parked (cap)`,
	},
	cut(QUIET, 'pre-gate', OLD_MINUTES),
]

function rows_of(text: string): Array<Array<string>> {
	return text
		.split('\n')
		.slice(2)
		.map((row) => row.slice(2, -2).split(' | '))
}

describe('lane_cut_stats.line', () => {
	it('counts one lane cuts by the phase each cut at', () => {
		const expected = 'run:cut ×3 (implementation ×2, pre-gate ×1)'

		expect(lane_cut_stats.line(EVENTS, ISSUE)).toBe(expected)
	})

	it('answers nothing for a lane that never cut', () => {
		expect(lane_cut_stats.line(EVENTS, 1)).toBeUndefined()
	})
})

describe('lane_cut_stats.table', () => {
	const text = lane_cut_stats.table(
		[dispatch(ISSUE), dispatch(OTHER), dispatch(QUIET)],
		WINDOW,
		EVENTS,
	)

	it('prints the column header', () => {
		expect(text.split('\n', 1)[0]).toBe('| cuts | per lane median | per lane max | total |')
	})

	it('prints the per-lane median and max and the total, all cuts and each phase', () => {
		expect(rows_of(text)).toStrictEqual([
			['all', '1', '3', '4'],
			['implementation', '0', '2', '2'],
			['pre-gate', '1', '1', '2'],
		])
	})

	it('prints only the all row with no cuts in the period', () => {
		const quiet = lane_cut_stats.table([dispatch(ISSUE)], WINDOW, [])

		expect(rows_of(quiet)).toStrictEqual([['all', '0', '0', '0']])
	})

	it('marks the per-lane cells missing with no lane in the period', () => {
		const empty = lane_cut_stats.table([], WINDOW, [])

		expect(rows_of(empty)).toStrictEqual([['all', lane_stats.MISSING, lane_stats.MISSING, '0']])
	})
})
