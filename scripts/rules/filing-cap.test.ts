import { describe, expect, it } from 'vitest'
import { filings_tail } from './delivered-rules-fixture'
import { filing_cap } from './filing-cap'

// joshuafolkken/kit#2119: the cap's counter, over a run's transcript tail. The delivery — refused at
// the eleventh filing, fired on every one past it — is pinned in `delivered-rules-filing.test.ts`;
// here the count itself is pinned, including that a guard-refused filing is not counted.

const THREE = 3
const ONE_REFUSED = 1

describe('prior_filing_count', () => {
	it('counts every filing the tail carries', () => {
		expect(filing_cap.prior_filing_count(filings_tail(THREE))).toBe(THREE)
	})

	it('is zero for a tail with no filing', () => {
		expect(filing_cap.prior_filing_count('')).toBe(0)
	})

	it('does not count a guard-refused filing', () => {
		expect(filing_cap.prior_filing_count(filings_tail(THREE, ONE_REFUSED))).toBe(
			THREE - ONE_REFUSED,
		)
	})
})
