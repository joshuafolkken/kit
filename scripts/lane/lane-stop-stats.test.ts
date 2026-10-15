import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'
import { lane_stop_stats } from './lane-stop-stats'

// joshuafolkken/kit#3789: one ledger period reduces to a row per ship stop reason — how long the ship
// stayed stopped until the same issue's next ship stage started, and how many stops nothing resumed.

const NOW = Date.parse('2026-10-14T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const MS_PER_MINUTE = 60_000
const ISSUE = 3789
const OTHER_ISSUE = 3790
const REVIEW = 'review'
const GATE = 'gate'
const NOT_MEASURED = 'not measured'

function minutes_before_now(minutes: number): string {
	return new Date(NOW - minutes * MS_PER_MINUTE).toISOString()
}

function stop(reason: string, minutes_before: number, issue = ISSUE): LedgerEntry {
	return { kind: 'stop', at: minutes_before_now(minutes_before), issue, reason }
}

// A ship stage of one minute that started `started_before` minutes ago.
function stage_started(started_before: number, issue = ISSUE): LedgerEntry {
	return {
		kind: 'stage',
		at: minutes_before_now(started_before - 1),
		stage: 'preflight',
		elapsed_ms: MS_PER_MINUTE,
		issue,
	}
}

function dispatch(minutes_before: number): LedgerEntry {
	return { kind: 'dispatch', at: minutes_before_now(minutes_before), issue: ISSUE }
}

// The cells of one reason's row, without the reason.
function row_of(entries: ReadonlyArray<LedgerEntry>, reason: string): Array<string> | undefined {
	const rows = lane_stop_stats
		.table(entries, WINDOW)
		.split('\n')
		.map((line) => line.slice(2, -2).split(' | '))

	return rows.find(([first]) => first === reason)?.slice(1)
}

describe('lane_stop_stats.table — the rows', () => {
	it('prints a row for every stop reason, conflict beside the ship stages', () => {
		const names = lane_stop_stats
			.table([], WINDOW)
			.split('\n')
			.slice(2)
			.map((line) => line.slice(2, -2).split(' | ', 1)[0])

		expect(names).toStrictEqual([...lane_stop_stats.REASONS])
		expect(names).toContain('conflict')
	})

	it('prints not measured, never zero, for a reason nothing stopped at', () => {
		expect(row_of([], GATE)).toStrictEqual([NOT_MEASURED, NOT_MEASURED, '0', '0'])
	})
})

describe('lane_stop_stats.table — the wait from a stop to the next ship', () => {
	it('times each stop to the start of the next ship stage of the same issue', () => {
		const entries = [
			stop(REVIEW, 60),
			stage_started(58),
			stop(REVIEW, 40),
			stage_started(34),
			stop(REVIEW, 20),
			stage_started(10),
		]

		expect(row_of(entries, REVIEW)).toStrictEqual(['6.0', '10.0', '3', '0'])
	})

	it('keeps each reason on its own row', () => {
		const entries = [stop(REVIEW, 30), stage_started(25), stop(GATE, 20), stage_started(18)]

		expect(row_of(entries, REVIEW)).toStrictEqual(['5.0', '5.0', '1', '0'])
		expect(row_of(entries, GATE)).toStrictEqual(['2.0', '2.0', '1', '0'])
	})

	it('reads no resumption off another issue, nor off the stage that stopped', () => {
		const stopped_stage = stage_started(31)
		const entries = [stopped_stage, stop(GATE, 30), stage_started(20, OTHER_ISSUE)]

		expect(row_of(entries, GATE)).toStrictEqual([NOT_MEASURED, NOT_MEASURED, '0', '1'])
	})
})

describe('lane_stop_stats.table — a stop nothing resumed', () => {
	it('counts a parked or abandoned stop as not resumed, outside the median and the maximum', () => {
		const entries = [stop(REVIEW, 50), stage_started(46), stop(REVIEW, 30)]

		expect(row_of(entries, REVIEW)).toStrictEqual(['4.0', '4.0', '1', '1'])
	})

	it('does not stretch a stop to the ship of a later dispatch of the same issue', () => {
		const entries = [stop(GATE, 50), dispatch(30), stage_started(20)]

		expect(row_of(entries, GATE)).toStrictEqual([NOT_MEASURED, NOT_MEASURED, '0', '1'])
	})

	it('leaves out a stop recorded before the period', () => {
		const day_and_a_half = 36 * 60

		expect(row_of([stop(GATE, day_and_a_half)], GATE)).toStrictEqual([
			NOT_MEASURED,
			NOT_MEASURED,
			'0',
			'0',
		])
	})
})
