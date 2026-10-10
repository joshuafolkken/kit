import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#3643: one ledger period reduces to a row per stage of a lane's run — median,
// maximum and run count — with `not measured` wherever nothing was recorded.

const NOW = Date.parse('2026-10-10T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const MS_PER_MINUTE = 60_000
const ISSUE = 3643
const OTHER_ISSUE = 3644
const REVIEW_MINUTES = [2, 4, 9]
const CI_WAIT = 'ci-wait'
const REVIEW = 'review'
const NOT_MEASURED_ROW = [lane_stage_stats.NOT_MEASURED, lane_stage_stats.NOT_MEASURED, '0']

function minutes_before_now(minutes: number): string {
	return new Date(NOW - minutes * MS_PER_MINUTE).toISOString()
}

function stage(name: string, minutes: number, ended_before: number, issue = ISSUE): LedgerEntry {
	return {
		kind: 'stage',
		at: minutes_before_now(ended_before),
		stage: name,
		elapsed_ms: minutes * MS_PER_MINUTE,
		issue,
	}
}

function dispatch(minutes_before: number, issue = ISSUE): LedgerEntry {
	return { kind: 'dispatch', at: minutes_before_now(minutes_before), issue }
}

// The cells of one stage's row, without the stage name.
function row_of(entries: ReadonlyArray<LedgerEntry>, name: string): Array<string> | undefined {
	const rows = lane_stage_stats
		.table(entries, WINDOW)
		.split('\n')
		.map((line) => line.slice(2, -2).split(' | '))

	return rows.find(([first]) => first === name)?.slice(1)
}

describe('lane_stage_stats.table — the recorded stages', () => {
	it('prints a row for the implementation and every ship stage, in running order', () => {
		const names = lane_stage_stats
			.table([], WINDOW)
			.split('\n')
			.slice(2)
			.map((line) => line.slice(2, -2).split(' | ', 1)[0])

		expect(names).toStrictEqual([...lane_stage_stats.STAGES])
	})

	it('reduces a stage to its median, its maximum and its run count, in minutes', () => {
		const entries = REVIEW_MINUTES.map((minutes) => stage(REVIEW, minutes, 1))

		expect(row_of(entries, REVIEW)).toStrictEqual(['4.0', '9.0', '3'])
	})

	it('keeps the round-one review and the wait for CI on rows of their own', () => {
		const entries = [stage(REVIEW, 2, 1), stage(CI_WAIT, 3, 1), stage('followup', 5, 1)]

		expect(row_of(entries, REVIEW)).toStrictEqual(['2.0', '2.0', '1'])
		expect(row_of(entries, CI_WAIT)).toStrictEqual(['3.0', '3.0', '1'])
	})

	it('prints not measured, never zero, for a stage nothing recorded', () => {
		expect(row_of([stage(REVIEW, 2, 1)], 'round-2')).toStrictEqual(NOT_MEASURED_ROW)
	})

	it('leaves out a stage recorded before the period', () => {
		const day_and_a_half = 36 * 60

		expect(row_of([stage(REVIEW, 2, day_and_a_half)], REVIEW)).toStrictEqual(NOT_MEASURED_ROW)
	})
})

describe('lane_stage_stats.table — the implementation, from dispatch to the first ship stage', () => {
	const { IMPLEMENT } = lane_stage_stats

	it('times it to the start of the first stage of the same issue', () => {
		// Dispatched 30 minutes ago; the preflight ended 19 minutes ago after running one minute.
		const entries = [dispatch(30), stage('preflight', 1, 19), stage('gate', 5, 10)]

		expect(row_of(entries, IMPLEMENT)).toStrictEqual(['10.0', '10.0', '1'])
	})

	it('reads no implementation off another issue or a stage with no issue', () => {
		const unowned: LedgerEntry = {
			kind: 'stage',
			at: minutes_before_now(1),
			stage: CI_WAIT,
			elapsed_ms: MS_PER_MINUTE,
		}

		expect(
			row_of([dispatch(30), stage('preflight', 1, 19, OTHER_ISSUE), unowned], IMPLEMENT),
		).toStrictEqual(NOT_MEASURED_ROW)
	})

	it('does not stretch a child that never shipped to the ship of its replacement', () => {
		const entries = [dispatch(50), dispatch(30), stage('preflight', 1, 19)]

		expect(row_of(entries, IMPLEMENT)).toStrictEqual(['10.0', '10.0', '1'])
	})

	it('reads no implementation off a stage that started before the dispatch', () => {
		const entries = [stage('preflight', 1, 40), dispatch(30)]

		expect(row_of(entries, IMPLEMENT)).toStrictEqual(NOT_MEASURED_ROW)
	})

	it('counts a ship resumed after a fix once', () => {
		const entries = [dispatch(30), stage('preflight', 1, 19), stage('preflight', 1, 5)]

		expect(row_of(entries, IMPLEMENT)?.at(-1)).toBe('1')
	})
})
