import type { LedgerEntry } from '#scripts/lane/lane-ledger'
import { describe, expect, it } from 'vitest'
import { run_board_usual } from './run-board-usual'

// joshuafolkken/kit#3769: each phase's usual time, read off the lane ledger's stage medians.

const MINUTE = 60_000
const AT = '2026-10-10T12:00:00.000Z'
const DISPATCHED = '2026-10-10T11:30:00.000Z'

function stage(name: string, minutes: number): LedgerEntry {
	return { kind: 'stage', at: AT, stage: name, elapsed_ms: minutes * MINUTE, issue: 1 }
}

describe('run_board_usual.usual_of', () => {
	it('gives a ship stage’s median to the phase the board names it by', () => {
		const usual = run_board_usual.usual_of([stage('round-2', 4), stage('preflight', 2)])

		expect(usual.get('round_two')).toBe(4 * MINUTE)
		expect(usual.get('ship')).toBe(2 * MINUTE)
	})

	it('gives the implementation, from dispatch to the first ship stage, to implement', () => {
		const dispatch: LedgerEntry = { kind: 'dispatch', at: DISPATCHED, issue: 1 }
		const usual = run_board_usual.usual_of([dispatch, stage('preflight', 10)])

		expect(usual.get('implement')).toBe(20 * MINUTE)
	})

	it('has no usual time for a phase no stage records', () => {
		const usual = run_board_usual.usual_of([stage('gate', 3)])

		expect([...usual.keys()]).toStrictEqual(['gate'])
	})
})
