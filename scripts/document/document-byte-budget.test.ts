import { statSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { describe, expect, it } from 'vitest'
import { agent_read_documents } from './ai-document-fixture'
import { document_byte_budget } from './document-byte-budget'

const {
	DOCUMENT_BYTE_BUDGET,
	JOSH_COMMANDS_CEILING_BYTES,
	ceiling_for,
	over_budget_message,
	recorded_bytes_for,
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
})
