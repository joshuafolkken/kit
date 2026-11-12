import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'
import { lane_stop_check_stats } from './lane-stop-check-stats'

// joshuafolkken/kit#7333: the period's followup check stops by the CI check that failed, and the
// period's longest stops with their issue and the instant they stopped.

const NOW = Date.parse('2026-11-12T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const ISSUE = 7333
const OTHER_ISSUE = 7334
const CODEQL = 'CodeQL'
const UNIT = 'Unit Tests (3/6)'
const NOT_MEASURED = 'not measured'

function minutes_before_now(minutes: number): string {
	return new Date(NOW - minutes * MS_PER_MINUTE).toISOString()
}

interface StopOptions {
	issue?: number
	reason?: string
	cause?: string
	checks?: Array<string>
}

const FOLLOWUP_CHECK = { issue: ISSUE, reason: 'followup', cause: 'check' }

function stop(minutes_before: number, options: StopOptions = {}): LedgerEntry {
	return { kind: 'stop', at: minutes_before_now(minutes_before), ...FOLLOWUP_CHECK, ...options }
}

// The dispatch that ends the wait of the stop on `issue` `minutes_before` ago.
function dispatch(minutes_before: number, issue = ISSUE): LedgerEntry {
	return { kind: 'dispatch', at: minutes_before_now(minutes_before), issue }
}

// Every row of a table, header and divider left out, each as its cells.
function rows_of(table: string): Array<Array<string>> {
	return table
		.split('\n')
		.slice(2)
		.map((line) => line.slice(2, -2).split(' | '))
}

function check_rows(entries: ReadonlyArray<LedgerEntry>): Array<Array<string>> {
	return rows_of(lane_stop_check_stats.check_table(entries, WINDOW))
}

function longest_rows(entries: ReadonlyArray<LedgerEntry>): Array<Array<string>> {
	return rows_of(lane_stop_check_stats.longest_table(entries, WINDOW))
}

describe('lane_stop_check_stats.check_table', () => {
	it('prints each failed check’s stops, wait total and wait max, the longest total first', () => {
		const entries = [
			stop(100, { checks: [UNIT] }),
			dispatch(90),
			stop(80, { checks: [CODEQL, UNIT] }),
			dispatch(20),
		]

		expect(check_rows(entries)).toStrictEqual([
			[UNIT, '2', '70.0', '60.0', '0'],
			[CODEQL, '1', '60.0', '60.0', '0'],
		])
	})

	it('counts a stop nothing resumed apart from the waits', () => {
		expect(check_rows([stop(30, { checks: [CODEQL] })])).toStrictEqual([
			[CODEQL, '1', NOT_MEASURED, NOT_MEASURED, '1'],
		])
	})

	it('counts a followup check stop that named no check under none named', () => {
		expect(check_rows([stop(30), dispatch(10)])).toStrictEqual([
			[lane_stop_check_stats.NO_CHECK, '1', '20.0', '20.0', '0'],
		])
	})

	it('leaves out every stop that was no followup check stop', () => {
		const entries = [stop(30, { reason: 'gate' }), stop(20, { cause: 'infra' }), dispatch(10)]

		expect(check_rows(entries)).toStrictEqual([])
	})
})

describe('lane_stop_check_stats.longest_table', () => {
	it('prints each ended stop with its issue and instant, the longest wait first', () => {
		const entries = [
			stop(100, { checks: [CODEQL] }),
			dispatch(90),
			stop(80, { issue: OTHER_ISSUE, reason: 'gate', cause: 'check' }),
			dispatch(20, OTHER_ISSUE),
		]

		expect(longest_rows(entries)).toStrictEqual([
			['gate', `#${String(OTHER_ISSUE)}`, minutes_before_now(80), 'check', '60.0'],
			['followup', `#${String(ISSUE)}`, minutes_before_now(100), CODEQL, '10.0'],
		])
	})

	it('leaves out a stop nothing resumed', () => {
		expect(longest_rows([stop(30, { checks: [CODEQL] })])).toStrictEqual([])
	})

	it('prints at most the longest rows it keeps', () => {
		const entries = Array.from({ length: lane_stop_check_stats.LONGEST_ROWS + 1 }, (_, index) => [
			stop(200, { issue: index + 1 }),
			dispatch(100 - index, index + 1),
		]).flat()

		expect(longest_rows(entries)).toHaveLength(lane_stop_check_stats.LONGEST_ROWS)
	})
})
