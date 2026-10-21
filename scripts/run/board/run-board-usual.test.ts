import type { LedgerEntry } from '#scripts/lane/lane-ledger'
import { describe, expect, it } from 'vitest'
import { run_board_usual } from './run-board-usual'

// joshuafolkken/kit#3769: each phase's usual time, read off the lane ledger's stage medians.

const MINUTE = 60_000
const AT = '2026-10-10T12:00:00.000Z'
const DISPATCHED = '2026-10-10T11:30:00.000Z'
const NOW = Date.parse('2026-10-10T13:00:00.000Z')
// Before the period the median is read over.
const LONG_AGO = '2026-09-01T12:00:00.000Z'

function stage(name: string, minutes: number, at = AT): LedgerEntry {
	return { kind: 'stage', at, stage: name, elapsed_ms: minutes * MINUTE, issue: 1 }
}

describe('run_board_usual.usual_of', () => {
	it('gives a ship stage’s median to the phase the board names it by', () => {
		const usual = run_board_usual.usual_of([stage('round-2', 4), stage('preflight', 2)], NOW)

		expect(usual.get('round_two')).toBe(4 * MINUTE)
		expect(usual.get('ship')).toBe(2 * MINUTE)
	})

	it('gives the implementation, from dispatch to the first ship stage, to implement', () => {
		const dispatch: LedgerEntry = { kind: 'dispatch', at: DISPATCHED, issue: 1 }
		const usual = run_board_usual.usual_of([dispatch, stage('preflight', 10)], NOW)

		expect(usual.get('implement')).toBe(20 * MINUTE)
	})

	it('has no usual time for a phase no stage records', () => {
		const usual = run_board_usual.usual_of([stage('gate', 3)], NOW)

		expect([...usual.keys()]).toStrictEqual(['gate'])
	})
})

// joshuafolkken/kit#4319: the median is the recent period's, an older season left out.
describe('run_board_usual.usual_of over the recent period', () => {
	it('leaves an entry older than the period out of the median', () => {
		const old = [stage('gate', 1, LONG_AGO), stage('gate', 1, LONG_AGO)]
		const usual = run_board_usual.usual_of([...old, stage('gate', 9)], NOW)

		expect(usual.get('gate')).toBe(9 * MINUTE)
	})

	it('falls back to the whole ledger where nothing is that recent', () => {
		const usual = run_board_usual.usual_of([stage('gate', 5, LONG_AGO)], NOW)

		expect(usual.get('gate')).toBe(5 * MINUTE)
	})

	it('keeps the whole ledger’s median for a stage the period has not recorded', () => {
		const dispatch: LedgerEntry = { kind: 'dispatch', at: AT, issue: 2 }
		const usual = run_board_usual.usual_of([stage('gate', 5, LONG_AGO), dispatch], NOW)

		expect(usual.get('gate')).toBe(5 * MINUTE)
	})
})
