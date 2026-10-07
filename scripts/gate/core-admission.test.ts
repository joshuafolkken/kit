import { describe, expect, it } from 'vitest'
import { core_admission, type LedgerEntry } from './core-admission'

// joshuafolkken/kit#3371: the machine reading holds only what a tool has already allocated, so a claim
// admitted moments ago must not have its declared memory added back onto the free memory — that
// admitted the next claim into memory about to be taken. And a claim admitted past the budget for
// memory must not be reported as a core shortfall.

const NOW = 100_000
const TOOL_MEMORY_MB = 2400
const TOOL_CORES = 2
const LEDGER_CORES = 9
const BUDGET_CORES = 11
const FREE_MB = 5000
const WAITED_MS = 120_000

function admitted(key: string, admitted_at: number | undefined): LedgerEntry {
	return {
		key,
		reservation: { weight: TOOL_CORES, claimed_at: 0, memory_mb: TOOL_MEMORY_MB, admitted_at },
	}
}

describe('core_admission.ledger_load — the load already inside the machine reading', () => {
	it('leaves out a claim admitted moments ago, whose tool has not allocated yet', () => {
		expect(core_admission.ledger_load([admitted('fresh', NOW)], NOW)).toEqual({
			cores: 0,
			memory_mb: 0,
		})
	})

	it('counts a claim admitted at least the ramp-up window ago', () => {
		const ramped = admitted('ramped', NOW - core_admission.RAMP_UP_MS)

		expect(core_admission.ledger_load([ramped], NOW)).toEqual({
			cores: TOOL_CORES,
			memory_mb: TOOL_MEMORY_MB,
		})
	})

	it('leaves out a claim that has not been admitted', () => {
		expect(core_admission.ledger_load([admitted('waiting', undefined)], NOW).memory_mb).toBe(0)
	})
})

describe('core_admission.describe_overflow — the summary line past the budget', () => {
	it('names the memory held against the memory budget when memory was read', () => {
		const note = core_admission.describe_overflow({
			overflow: {
				waited_ms: WAITED_MS,
				ledger: { cores: LEDGER_CORES, memory_mb: FREE_MB + TOOL_MEMORY_MB },
				budget: { cores: BUDGET_CORES, memory_mb: FREE_MB },
			},
		})

		expect(note).toBe(
			'started past the core budget after 120s — the ledger held 9 cores against a budget of 11 and 7400 MB of memory against 5000 MB',
		)
	})

	it('says nothing about memory when no memory limit was read', () => {
		const note = core_admission.describe_overflow({
			overflow: {
				waited_ms: WAITED_MS,
				ledger: { cores: LEDGER_CORES, memory_mb: TOOL_MEMORY_MB },
				budget: { cores: BUDGET_CORES, memory_mb: Infinity },
			},
		})

		expect(note).not.toContain('MB')
	})
})
