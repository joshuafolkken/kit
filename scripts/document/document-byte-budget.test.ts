import { statSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { describe, expect, it } from 'vitest'
import { agent_read_documents } from './ai-document-fixture'
import { document_byte_budget } from './document-byte-budget'

const {
	DOCUMENT_BYTE_BUDGET,
	BLOCK_BYTES,
	block_ceiling,
	over_budget_message,
	stale_budget_message,
} = document_byte_budget

function byte_size(relative_path: string): number {
	return statSync(package_file(relative_path)).size
}

function sorted(paths: ReadonlyArray<string>): Array<string> {
	return [...paths].toSorted((left, right) => left.localeCompare(right))
}

describe('agent-read document byte budget', () => {
	it.each(DOCUMENT_BYTE_BUDGET)('$path stays within its block ceiling', ({ path, bytes }) => {
		const current = byte_size(path)
		const message = over_budget_message(path, current, bytes)

		expect(current, message).toBeLessThanOrEqual(bytes)
	})

	// The growth guard alone lets a recorded ceiling sit a block or more above the shrunk document
	// forever — the stale-loose ratchet joshuafolkken/kit#2125 found. This pins the other direction: a
	// record more than a block above the actual size must be lowered to the block multiple, so a
	// reduction is held rather than leaving slack the ratchet stops enforcing.
	it.each(DOCUMENT_BYTE_BUDGET)(
		'$path keeps its ratchet tight, not stale above its block',
		({ path, bytes }) => {
			const current = byte_size(path)
			const message = stale_budget_message(path, bytes, current)

			expect(bytes, message).toBeLessThanOrEqual(block_ceiling(current))
		},
	)

	it('budgets exactly the documents in scope — no stale entry, no un-budgeted file', () => {
		const budgeted = sorted(DOCUMENT_BYTE_BUDGET.map((entry) => entry.path))
		const in_scope = sorted(agent_read_documents())

		expect(budgeted).toEqual(in_scope)
	})

	it('records every ceiling as a whole block, so no entry is a hand-picked byte count', () => {
		for (const { path, bytes } of DOCUMENT_BYTE_BUDGET) {
			expect(bytes % BLOCK_BYTES, `${path} must record a whole block`).toBe(0)
		}
	})
})

// The property that stops parallel command-adding lanes serializing on this file: two documents whose
// sizes fall in the same block get the same recorded ceiling, so growth within a block needs no edit
// and two lanes crossing into the same block make the same edit — one git auto-merges.
describe('block_ceiling — the deterministic, conflict-free ceiling', () => {
	it('is pinned to 4096 so it cannot be widened to loosen every ceiling at once', () => {
		expect(BLOCK_BYTES).toBe(4096)
	})

	it('maps every size within one block to the same ceiling', () => {
		const base = 40_960

		expect(block_ceiling(base + 1)).toBe(base + BLOCK_BYTES)
		expect(block_ceiling(base + BLOCK_BYTES - 1)).toBe(base + BLOCK_BYTES)
	})

	it('two lanes crossing into the same block record the same value', () => {
		const start = 112_000
		const lane_a = start + 500
		const lane_b = start + 1500

		expect(block_ceiling(lane_a)).toBe(block_ceiling(lane_b))
	})

	it('returns the block itself for a size already on a boundary', () => {
		expect(block_ceiling(BLOCK_BYTES)).toBe(BLOCK_BYTES)
		expect(block_ceiling(0)).toBe(0)
	})
})

const EXAMPLE_PATH = 'docs/example.md'

describe('the raise/lower messages name the concrete block value to record', () => {
	it('over-budget names the next block multiple to raise to', () => {
		const recorded = block_ceiling(1000)
		const current = recorded + 1
		const message = over_budget_message(EXAMPLE_PATH, current, recorded)

		expect(message).toContain(`raise its recorded size to ${block_ceiling(current).toString()}`)
	})

	it('stale names the block multiple to lower to', () => {
		const current = 1000
		const recorded = block_ceiling(current) + BLOCK_BYTES
		const message = stale_budget_message(EXAMPLE_PATH, recorded, current)

		expect(message).toContain(`lower its recorded size to ${block_ceiling(current).toString()}`)
	})
})
