import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { document_byte_budget } from './document-byte-budget'
import { entry_read_budget } from './entry-read-budget'
import { read_set_cli } from './read-set-cli'

const { ENTRY_READ_BUDGET, entry_total_bytes, over_budget_message, stale_budget_message } =
	entry_read_budget
const { BLOCK_BYTES, block_ceiling } = document_byte_budget

const ROOT = process.cwd()

function sorted(values: ReadonlyArray<string>): Array<string> {
	return [...values].toSorted((left, right) => left.localeCompare(right))
}

describe('consumer resident document', () => {
	it.each(ENTRY_READ_BUDGET)(
		'$entry measures kit rules even when a consumer adds resident rules',
		({ entry }) => {
			const consumer = mkdtempSync(path.join(os.tmpdir(), 'kit-entry-budget-'))

			try {
				writeFileSync(path.join(consumer, 'CLAUDE.md'), 'consumer rules'.repeat(10_000))
				expect(entry_total_bytes(consumer, entry)).toBe(entry_total_bytes(ROOT, entry))
			} finally {
				rmSync(consumer, { recursive: true, force: true })
			}
		},
	)
})

describe('entry-read byte budget — the primary ceiling on what an entry reads', () => {
	it.each(ENTRY_READ_BUDGET)('$entry stays within its block ceiling', ({ entry, bytes }) => {
		const current = entry_total_bytes(ROOT, entry)
		const message = over_budget_message(entry, current, bytes)

		expect(current, message).toBeLessThanOrEqual(bytes)
	})

	// The other direction of the ratchet: a recorded ceiling more than a block above the entry's actual
	// total is stale-loose and must be lowered, so a reduction in what an entry reads is held rather
	// than leaving slack the ratchet stops enforcing.
	it.each(ENTRY_READ_BUDGET)(
		'$entry keeps its ratchet tight, not stale above its block',
		({ entry, bytes }) => {
			const current = entry_total_bytes(ROOT, entry)
			const message = stale_budget_message(entry, bytes, current)

			expect(bytes, message).toBeLessThanOrEqual(block_ceiling(current))
		},
	)

	it('records every ceiling as a whole block, so no entry is a hand-picked byte count', () => {
		for (const { entry, bytes } of ENTRY_READ_BUDGET) {
			expect(bytes % BLOCK_BYTES, `${entry} must record a whole block`).toBe(0)
		}
	})

	// Names exactly the entries the CLI offers — the four trigger-table keywords and the synthetic
	// lane child. A stale entry or a missing one would leave an entry unbudgeted or a budget unbound.
	it('budgets exactly the known entries', () => {
		const budgeted = sorted(ENTRY_READ_BUDGET.map((one) => one.entry))
		const known = sorted(read_set_cli.known_entries(ROOT))

		expect(budgeted).toEqual(known)
	})
})

// joshuafolkken/kit#2294 was the FIRST downward move on this ratchet — `pre-gate-cut.md` was
// compressed, so every entry that reads it crossed a block downward. These are the pre-#2294 ceilings;
// a recorded value back at or above one of them is the ratchet silently climbing past the reduction,
// which is exactly what the downward move exists to prevent.
const PRE_2294_CEILING: ReadonlyMap<string, number> = new Map([
	['kickoff', 270_336],
	['fullrun', 270_336],
	['halfrun', 270_336],
	['backlogrun', 274_432],
	['lane-child', 143_360],
])

describe('the first downward ratchet move (joshuafolkken/kit#2294) is held', () => {
	it.each(ENTRY_READ_BUDGET)('$entry stays below its pre-#2294 ceiling', ({ entry, bytes }) => {
		const previous = PRE_2294_CEILING.get(entry)

		expect(previous, `${entry} must have a pre-#2294 ceiling recorded`).toBeDefined()
		if (previous !== undefined) expect(bytes).toBeLessThan(previous)
	})
})

describe('the raise/lower messages name the concrete block value to record', () => {
	it('over-budget names the next block multiple to raise to', () => {
		const recorded = block_ceiling(1000)
		const current = recorded + 1
		const message = over_budget_message('fullrun', current, recorded)

		expect(message).toContain(`raise its recorded size to ${block_ceiling(current).toString()}`)
	})

	it('stale names the block multiple to lower to', () => {
		const current = 1000
		const recorded = block_ceiling(current) + BLOCK_BYTES
		const message = stale_budget_message('fullrun', recorded, current)

		expect(message).toContain(`lower its recorded size to ${block_ceiling(current).toString()}`)
	})
})
