import { describe, expect, it } from 'vitest'
import { issue_citation } from './issue-citation'

describe('issue_citation.has_bare_reference', () => {
	it('flags a bare #N in session-facing prose', () => {
		expect(issue_citation.has_bare_reference('closed by #123 earlier')).toBe(true)
	})

	it('flags a bare owner/repo#N', () => {
		expect(issue_citation.has_bare_reference('see joshuafolkken/kit#45')).toBe(true)
	})

	it('is silent on a link-form citation', () => {
		expect(
			issue_citation.has_bare_reference('[#12](https://github.com/o/r/issues/12) — 要約'),
		).toBe(false)
	})

	it('is silent on a cross-repo link-form citation', () => {
		expect(issue_citation.has_bare_reference('[joshuafolkken/kit#45](https://github.com/x)')).toBe(
			false,
		)
	})

	it('flags a bare reference sitting beside a linked one', () => {
		expect(issue_citation.has_bare_reference('done [#12](https://x) but also #34')).toBe(true)
	})

	it('is silent when there is no reference', () => {
		expect(issue_citation.has_bare_reference('no issue here, just prose')).toBe(false)
	})
})
