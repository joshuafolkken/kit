import { describe, expect, it } from 'vitest'
import { core_admission, type LedgerEntry } from './core-admission'

// joshuafolkken/kit#4313: a solo gate's unit claim waited out the 120 s cap behind one core of load
// outside the ledger, and a `lint:related` that fitted the free cores waited behind a heavy unit claim
// that did not. The first waiter is now held by the ledger alone, and a lighter claim passes a waiter
// claimed within the window before it.

const CORES = 11
const SOLO_UNIT_WEIGHT = 7
const HEAVY_WEIGHT = 8
const RUNNING_WEIGHT = 6
const LIGHT_WEIGHT = 2

function running(key: string, weight: number): LedgerEntry {
	return { key, reservation: { weight, claimed_at: 0, admitted_at: 0 } }
}

function waiting(key: string, weight: number, claimed_at: number): LedgerEntry {
	return { key, reservation: { weight, claimed_at } }
}

// A solo gate: lint, type check and spell check running, its unit claim waiting.
const SOLO_GATE = [
	running('lint', 2),
	running('type', 1),
	running('spell', 1),
	waiting('unit', SOLO_UNIT_WEIGHT, 1),
]

function outside_load(cores: number): { cores: number; memory_mb: number; busy_excess: number } {
	return { cores: CORES - cores, memory_mb: Infinity, busy_excess: cores }
}

describe('core_admission.is_admitted — the first waiter and load outside the ledger', () => {
	it("admits a solo gate's unit claim while outside load holds a core", () => {
		expect(core_admission.is_admitted('unit', SOLO_GATE, outside_load(1))).toBe(true)
	})

	it('still holds the first waiter on the cores the ledger holds', () => {
		const ledger = [running('other', CORES), waiting('unit', SOLO_UNIT_WEIGHT, 1)]

		expect(core_admission.is_admitted('unit', ledger, outside_load(0))).toBe(false)
	})

	it('holds a claim queued behind a waiter on the outside load', () => {
		const late = core_admission.BYPASS_WINDOW_MS + 1
		const ledger = [...SOLO_GATE, waiting('next', 1, late)]

		expect(core_admission.is_admitted('next', ledger, outside_load(1))).toBe(false)
	})
})

describe('core_admission.is_admitted — a light claim passes a heavy waiter', () => {
	const HEAVY_AHEAD = [running('run', RUNNING_WEIGHT), waiting('heavy', HEAVY_WEIGHT, 1)]

	it('admits a light claim that fits beside the running claims', () => {
		const ledger = [...HEAVY_AHEAD, waiting('light', LIGHT_WEIGHT, 2)]

		expect(core_admission.is_admitted('light', ledger, outside_load(0))).toBe(true)
	})

	it('holds a claim that does not fit beside the running claims either', () => {
		const ledger = [...HEAVY_AHEAD, waiting('wide', CORES - RUNNING_WEIGHT + 1, 2)]

		expect(core_admission.is_admitted('wide', ledger, outside_load(0))).toBe(false)
	})

	// The bound: a claim made past the window queues, so the heavy claim is passed a bounded number of
	// times and runs once the claims already in flight finish.
	it('holds a light claim made past the window after the waiter', () => {
		const late = 1 + core_admission.BYPASS_WINDOW_MS
		const ledger = [...HEAVY_AHEAD, waiting('light', LIGHT_WEIGHT, late)]

		expect(core_admission.is_admitted('light', ledger, outside_load(0))).toBe(false)
	})

	it('admits the heavy waiter first once the running claims leave it room', () => {
		const ledger = [running('run', 1), waiting('heavy', HEAVY_WEIGHT, 1)]

		expect(core_admission.is_admitted('heavy', ledger, outside_load(0))).toBe(true)
	})

	// The oldest's exemption is for a claim heavier than the machine, not for one the passers still hold:
	// starting it on top of them would take cores and memory the budget does not have.
	it('holds the oldest waiter while a claim that passed it still holds the room', () => {
		const passer = {
			key: 'passer',
			reservation: { weight: RUNNING_WEIGHT, claimed_at: 2, admitted_at: 2 },
		}
		const ledger = [waiting('heavy', HEAVY_WEIGHT, 1), passer]

		expect(core_admission.is_admitted('heavy', ledger, outside_load(0))).toBe(false)
	})

	it('runs the claims one round admits within the budget', () => {
		const ledger = [...HEAVY_AHEAD, waiting('light', LIGHT_WEIGHT, 2)]

		expect(core_admission.admitted_keys(ledger, CORES)).toEqual(new Set(['run', 'light']))
	})
})
