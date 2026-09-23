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

// joshuafolkken/kit#2422: the stop guard asks whether *this turn* filed, so a filing before the last
// prompt must not count.
const PROMPT_LINE = JSON.stringify({
	type: 'user',
	timestamp: '2026-09-23T00:00:00.000Z',
	message: { role: 'user', content: 'next task' },
})

describe('turn_filing_count', () => {
	it('counts only the filings after the last prompt', () => {
		const tail = [filings_tail(THREE), PROMPT_LINE, filings_tail(ONE_REFUSED + 1)].join('\n')

		expect(filing_cap.turn_filing_count(tail)).toBe(ONE_REFUSED + 1)
	})

	it('is zero when the filings all precede the last prompt', () => {
		expect(filing_cap.turn_filing_count([filings_tail(THREE), PROMPT_LINE].join('\n'))).toBe(0)
	})

	it('reads the whole tail when no prompt is on it', () => {
		expect(filing_cap.turn_filing_count(filings_tail(THREE))).toBe(THREE)
	})
})
