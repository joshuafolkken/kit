import { describe, expect, it } from 'vitest'
import { MAX_SCANNED } from './git-gh-issue-list'
import { cutoff_of, PAGE_CEILING_CAUSE } from './listing-cutoff'

// joshuafolkken/kit#1067: every caller of the open-issue listing asks "did I see everything", and
// each one used to answer it in its own words. One definition means a caller cannot quietly disagree
// with the others about what a complete listing is.

const LIMIT = 50

describe('cutoff_of', () => {
	it('calls a listing that ran out complete', () => {
		expect(cutoff_of(LIMIT - 1, LIMIT, false)).toBe('none')
	})

	it('calls a listing that filled the caller limit cut short by it', () => {
		expect(cutoff_of(LIMIT, LIMIT, false)).toBe('row_limit')
	})

	it('calls a short listing the paging stopped cut short by the page ceiling', () => {
		expect(cutoff_of(LIMIT - 1, LIMIT, true)).toBe('page_ceiling')
	})

	// The paging stops as soon as `limit` rows have been selected, so a listing that filled `limit`
	// never reached the ceiling. `row_limit` is checked first so that stays true even if it changes.
	it('names the caller limit when both would apply', () => {
		expect(cutoff_of(LIMIT, LIMIT, true)).toBe('row_limit')
	})
})

describe('PAGE_CEILING_CAUSE', () => {
	// A second spelling of the cause would cite a number that no longer matches the ceiling.
	it('cites the ceiling the paging actually applies', () => {
		expect(PAGE_CEILING_CAUSE).toContain(String(MAX_SCANNED))
	})
})
