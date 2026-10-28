import { describe, expect, it } from 'vitest'
import { run_merge_outcome } from './run-merge-outcome'

// joshuafolkken/kit#4102: the names `run:merge --driver` prints and the driver reads back against.
describe('run_merge_outcome.CHILD_OUTCOMES', () => {
	it.each(['merged', 'parked', 'usage-limit', 'failed', 'unresolved'])('holds %s', (outcome) => {
		expect(run_merge_outcome.CHILD_OUTCOMES).toContain(outcome)
	})

	it('names each outcome once', () => {
		const outcomes = run_merge_outcome.CHILD_OUTCOMES

		expect(new Set(outcomes).size).toBe(outcomes.length)
	})
})
