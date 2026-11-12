import { describe, expect, it } from 'vitest'
import { run_ship_review_reason } from './run-ship-review-reason'

// joshuafolkken/kit#5296: the words the ship's review stage writes on its event line.
describe('run_ship_review_reason', () => {
	it('says a held round 1 was reused', () => {
		expect(run_ship_review_reason.reused({ reuse: 'held' })).toBe(
			'reused: round 1 attested on this branch, its tree held',
		)
	})

	it('says a round 1 moved only where round 2 reads was reused, leaving the delta to round 2', () => {
		expect(run_ship_review_reason.reused({ reuse: 'delta' })).toContain("round 2's delta")
	})

	// joshuafolkken/kit#5662: a reuse past a moved doc says which moves no round reads.
	it('appends the moves a reused round 1 passed over', () => {
		const note = 'passed over documentation, a prompt or an inert path no round executes: docs/a.md'

		expect(run_ship_review_reason.reused({ reuse: 'held', note })).toBe(
			`reused: round 1 attested on this branch, its tree held — ${note}`,
		)
	})

	it('names the cause a round 1 was reviewed again for', () => {
		expect(run_ship_review_reason.ran({ reuse: 'again', cause: 'the issue changed' })).toBe(
			'ran: --review with no reusable round 1 — the issue changed',
		)
	})

	it('names a fallback cause when the reuse answer carries none', () => {
		expect(run_ship_review_reason.ran({ reuse: 'again' })).toBe(
			'ran: --review with no reusable round 1 — the recorded round does not cover this tree',
		)
	})
})
