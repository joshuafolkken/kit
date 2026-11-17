import { describe, expect, it } from 'vitest'
import { core_admission, type LedgerEntry } from './core-admission'
import { core_weights } from './core-weights'

// joshuafolkken/kit#7776: lint claims a tenth-of-a-core weight read off the ledger, so a sixth lint fits
// the 11-core budget that five two-core lints filled — and one past the budget still waits.

const CORES = 11
const LINT_WEIGHT = core_weights.CORE_WEIGHTS.lint
const FIVE_RUNNING = 5
const SIX_RUNNING = 6
const WHOLE_LINT_WEIGHT = 2

function running_lints(count: number, weight: number): Array<LedgerEntry> {
	return Array.from({ length: count }, (_unused, index) => ({
		key: `lint-${String(index)}`,
		reservation: { weight, claimed_at: 0, admitted_at: 0 },
	}))
}

function with_waiting_lint(count: number, weight: number): Array<LedgerEntry> {
	return [...running_lints(count, weight), { key: 'next', reservation: { weight, claimed_at: 1 } }]
}

const IDLE_MACHINE = { cores: CORES, memory_mb: Infinity, busy_excess: 0 }

describe('core_admission.is_admitted — fractional reservations', () => {
	it('admits a sixth lint whose fractional weights still sum within the budget', () => {
		const ledger = with_waiting_lint(FIVE_RUNNING, LINT_WEIGHT)

		expect(core_admission.is_admitted('next', ledger, IDLE_MACHINE)).toBe(true)
	})

	it('held the same sixth lint at the whole two-core weight', () => {
		const ledger = with_waiting_lint(FIVE_RUNNING, WHOLE_LINT_WEIGHT)

		expect(core_admission.is_admitted('next', ledger, IDLE_MACHINE)).toBe(false)
	})

	it('holds a lint whose fractional weight would sum past the budget', () => {
		const ledger = with_waiting_lint(SIX_RUNNING, LINT_WEIGHT)

		expect(core_admission.is_admitted('next', ledger, IDLE_MACHINE)).toBe(false)
	})
})
