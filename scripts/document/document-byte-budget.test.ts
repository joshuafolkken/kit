import { statSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { describe, expect, it } from 'vitest'
import { agent_read_documents } from './ai-document-fixture'
import { document_byte_budget } from './document-byte-budget'

const {
	DOCUMENT_BYTE_BUDGET,
	JOSH_COMMANDS_CEILING_BYTES,
	SLACK_BYTES,
	ceiling_for,
	over_budget_message,
	recorded_bytes_for,
	stale_budget_message,
} = document_byte_budget

const JOSH_COMMANDS = 'docs/josh-commands.md'

function byte_size(relative_path: string): number {
	return statSync(package_file(relative_path)).size
}

function sorted(paths: ReadonlyArray<string>): Array<string> {
	return [...paths].toSorted((left, right) => left.localeCompare(right))
}

describe('agent-read document byte budget', () => {
	it.each(DOCUMENT_BYTE_BUDGET)('$path stays within its byte ceiling', ({ path, bytes }) => {
		const current = byte_size(path)
		const message = over_budget_message(path, current, bytes)

		expect(current, message).toBeLessThanOrEqual(ceiling_for(bytes))
	})

	// The growth guard alone lets a recorded size sit far above the shrunk document forever — the
	// stale-loose ratchet joshuafolkken/kit#2125 found on chain-rule.md. This pins the other direction:
	// a record more than a slack above the actual size must be lowered, so a reduction is held.
	it.each(DOCUMENT_BYTE_BUDGET)(
		'$path keeps its ratchet tight, not stale above actual',
		({ path, bytes }) => {
			const current = byte_size(path)
			const message = stale_budget_message(path, bytes, current)

			expect(bytes, message).toBeLessThanOrEqual(current + SLACK_BYTES)
		},
	)

	it('budgets exactly the documents in scope — no stale entry, no un-budgeted file', () => {
		const budgeted = sorted(DOCUMENT_BYTE_BUDGET.map((entry) => entry.path))
		const in_scope = sorted(agent_read_documents())

		expect(budgeted).toEqual(in_scope)
	})

	it('holds docs/josh-commands.md under 80 KB', () => {
		const recorded = recorded_bytes_for(JOSH_COMMANDS)

		expect(recorded, `${JOSH_COMMANDS} must have a budget entry`).toBeDefined()
		expect(ceiling_for(recorded ?? NaN)).toBeLessThanOrEqual(JOSH_COMMANDS_CEILING_BYTES)
	})

	// The slack is the one dial that loosens every ceiling at once. Widening it to dodge a bump is the
	// workaround the ratchet exists to forbid, so its value is pinned here — a change to it fails this
	// test and forces the reason into the diff, rather than quietly raising the whole budget.
	it('pins the shared slack so it cannot be widened to dodge a bump', () => {
		const SLACK = 512

		expect(SLACK_BYTES).toBe(SLACK)
	})

	// The over-budget message names the exact value to record — the current size — so a reader raising
	// a ceiling copies the number rather than computing it (joshuafolkken/kit#2176).
	it('states the concrete value to record when a document is over budget', () => {
		const recorded = 1000
		const current = ceiling_for(recorded) + 1
		const message = over_budget_message('docs/example.md', current, recorded)

		expect(message).toContain(`raise its recorded size to ${current.toString()}`)
	})
})
