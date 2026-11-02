import { describe, expect, it } from 'vitest'
import { core_admission, type LedgerEntry } from './core-admission'

// joshuafolkken/kit#5767: a ship's commit stage queued behind other lanes' heavy checks.
// A claim with the priority mark is ordered before every claim without it, and none passes it.

const CORES = 8
const RUNNING_WEIGHT = 4
const HEAVY_WEIGHT = 6
const LIGHT_WEIGHT = 2
const BUDGET = { cores: CORES, memory_mb: Infinity }
const LATER_MS = 1000

function running(key: string, weight: number): LedgerEntry {
	return { key, reservation: { weight, claimed_at: 0, admitted_at: 0 } }
}

function waiting(key: string, weight: number, claimed_at: number, is_priority?: true): LedgerEntry {
	return { key, reservation: { weight, claimed_at, is_priority } }
}

// Another lane's gate holds half the machine and its heavy check waits; the ship's commit claims later.
const BUSY_LEDGER = [
	running('gate', RUNNING_WEIGHT),
	waiting('heavy', HEAVY_WEIGHT, 1),
	waiting('commit', LIGHT_WEIGHT, core_admission.HEAVIER_BYPASS_WINDOW_MS + LATER_MS, true),
]

describe('core_admission.is_admitted — the priority mark', () => {
	it('admits a priority claim ahead of a waiter it could not pass without the mark', () => {
		expect(core_admission.is_admitted('commit', BUSY_LEDGER, BUDGET)).toBe(true)
	})

	it('queues the same claim behind that waiter without the mark', () => {
		const unmarked = BUSY_LEDGER.map((entry) =>
			entry.key === 'commit'
				? { ...entry, reservation: { ...entry.reservation, is_priority: undefined } }
				: entry,
		)

		expect(core_admission.is_admitted('commit', unmarked, BUDGET)).toBe(false)
	})

	it('still waits for the room the running claims hold', () => {
		const full = [running('gate', CORES), BUSY_LEDGER[2]].filter((entry) => entry !== undefined)

		expect(core_admission.is_admitted('commit', full, BUDGET)).toBe(false)
	})

	it('never lets a claim without the mark pass a priority waiter', () => {
		const ledger = [
			running('gate', RUNNING_WEIGHT),
			waiting('review', HEAVY_WEIGHT, LATER_MS, true),
			waiting('lint', LIGHT_WEIGHT, LATER_MS),
		]

		expect(core_admission.is_admitted('lint', ledger, BUDGET)).toBe(false)
	})

	it('orders a priority claim before an earlier claim without the mark', () => {
		const ordered = BUSY_LEDGER.toSorted(core_admission.compare_claim).map((entry) => entry.key)

		expect(ordered).toStrictEqual(['commit', 'gate', 'heavy'])
	})
})
