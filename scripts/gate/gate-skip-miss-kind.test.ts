import { describe, expect, it } from 'vitest'
import { gate_skip } from './gate-skip'

// joshuafolkken/kit#5234: a miss's kind is read off the sentence `gate_reuse` wrote, so the ledger
// counts the reasons a pre-push hook ran its suite without a second wording of them.

const RECORD_MISS = 'no green gate record matches the changed files'

describe('gate_skip.miss_kind', () => {
	it.each([
		['the merge base could not be read', 'no-base'],
		['no file differs from the merge base', 'no-change'],
		[RECORD_MISS, 'no-record'],
		[`${RECORD_MISS} (37 changed, record covers 2, 35 differ)`, 'record-differs'],
		['the merge base moved since the green gate (abc → def)', 'base-moved'],
		['a checked tool or environment variable changed since the green gate', 'inputs-moved'],
		['arguments were passed to the hook', 'other'],
	])('classifies %s as %s', (miss, kind) => {
		expect(gate_skip.miss_kind(miss)).toBe(kind)
	})

	it('classifies what gate_reuse answers for an unreadable base', () => {
		const reuse = gate_skip.gate_reuse({}, undefined)

		expect('miss' in reuse && gate_skip.miss_kind(reuse.miss)).toBe('no-base')
	})
})
