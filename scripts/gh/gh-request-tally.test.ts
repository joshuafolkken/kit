import { beforeEach, describe, expect, it } from 'vitest'
import { gh_request_tally } from './gh-request-tally'

// joshuafolkken/kit#6694: the process-wide counts of gh requests and 304 answers.

beforeEach(() => {
	gh_request_tally.reset()
})

describe('gh_request_tally', () => {
	it('starts at zero', () => {
		expect(gh_request_tally.snapshot()).toStrictEqual({ calls: 0, not_modified: 0 })
	})

	it('adds one per counted call and per counted 304', () => {
		gh_request_tally.count_call()
		gh_request_tally.count_call()
		gh_request_tally.count_not_modified()

		expect(gh_request_tally.snapshot()).toStrictEqual({ calls: 2, not_modified: 1 })
	})

	it('hands out a copy, so a held snapshot does not move with later counts', () => {
		const held = gh_request_tally.snapshot()

		gh_request_tally.count_call()

		expect(held.calls).toBe(0)
	})

	it('reset returns both counts to zero', () => {
		gh_request_tally.count_call()
		gh_request_tally.count_not_modified()
		gh_request_tally.reset()

		expect(gh_request_tally.snapshot()).toStrictEqual({ calls: 0, not_modified: 0 })
	})
})
