import { describe, expect, it } from 'vitest'
import { observation_ledger, OBSERVATION_LEDGER_PATH } from './observation-ledger'

// joshuafolkken/kit#1810: this is the one place that answers "does the working tree hold a pending
// observation append?", asked by both `observations-flush.ts` and `pnpm josh followup`'s short-circuit.
const MODIFIED_LEDGER = ` M ${OBSERVATION_LEDGER_PATH}`
const UNTRACKED_LEDGER = `?? ${OBSERVATION_LEDGER_PATH}`
const OTHER_CHANGE = ' M scripts/git/git-command.ts'
const LOOKALIKE_PATH = ` M ${OBSERVATION_LEDGER_PATH}.bak`

describe('observation_ledger.has_pending_append', () => {
	it('is true when the ledger was modified', () => {
		expect(observation_ledger.has_pending_append(MODIFIED_LEDGER)).toBe(true)
	})

	it('is true when the ledger is untracked', () => {
		expect(observation_ledger.has_pending_append(UNTRACKED_LEDGER)).toBe(true)
	})

	it('finds the ledger among other changed paths', () => {
		const status = [OTHER_CHANGE, MODIFIED_LEDGER].join('\n')

		expect(observation_ledger.has_pending_append(status)).toBe(true)
	})

	it('is false on a clean tree', () => {
		expect(observation_ledger.has_pending_append('')).toBe(false)
	})

	it('is false when only other files changed', () => {
		expect(observation_ledger.has_pending_append(OTHER_CHANGE)).toBe(false)
	})

	// The path is compared whole, so a sibling whose name merely starts with the ledger path is not it.
	it('does not mistake a look-alike path for the ledger', () => {
		expect(observation_ledger.has_pending_append(LOOKALIKE_PATH)).toBe(false)
	})
})
