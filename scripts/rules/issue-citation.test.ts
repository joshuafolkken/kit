import { describe, expect, it } from 'vitest'
import { issue_citation } from './issue-citation'

// Reused across the suites below so the same literal is not spelled twice: a cross-repo mention, the
// argument it becomes, and a reply mixing a linked reference with a bare one.
const CROSS_REPO_PROSE = 'see joshuafolkken/kit#45'
const CROSS_REPO_REF = 'joshuafolkken/kit#45'
const LINKED_BESIDE_BARE = 'done [#12](https://x) but also #34'

describe('issue_citation.has_bare_reference', () => {
	it('flags a bare #N in session-facing prose', () => {
		expect(issue_citation.has_bare_reference('closed by #123 earlier')).toBe(true)
	})

	it('flags a bare owner/repo#N', () => {
		expect(issue_citation.has_bare_reference(CROSS_REPO_PROSE)).toBe(true)
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
		expect(issue_citation.has_bare_reference(LINKED_BESIDE_BARE)).toBe(true)
	})

	it('is silent when there is no reference', () => {
		expect(issue_citation.has_bare_reference('no issue here, just prose')).toBe(false)
	})
})

describe('issue_citation.bare_references', () => {
	it('collects the bare references in order', () => {
		expect(issue_citation.bare_references('done in #123 and #456')).toEqual(['#123', '#456'])
	})

	it('keeps the owner/repo prefix on a qualified reference', () => {
		expect(issue_citation.bare_references(CROSS_REPO_PROSE)).toEqual([CROSS_REPO_REF])
	})

	it('drops a reference repeated in the reply', () => {
		expect(issue_citation.bare_references('#7 then #7 again')).toEqual(['#7'])
	})

	it('omits a linked reference sitting beside a bare one', () => {
		expect(issue_citation.bare_references(LINKED_BESIDE_BARE)).toEqual(['#34'])
	})

	it('drops a path-like prefix that is not a single owner/repo', () => {
		expect(issue_citation.bare_references('touched src/lib/x#5')).toEqual(['#5'])
	})
})

describe('issue_citation.bare_references — tightened detection', () => {
	it('ignores a #N inside a fenced code block', () => {
		const message = 'run this:\n```\ngh api ... closes #12\n```\ndone'

		expect(issue_citation.bare_references(message)).toEqual([])
	})

	it('ignores a #N inside a tilde-fenced code block', () => {
		const message = 'run this:\n~~~\ngh api ... closes #12\n~~~\ndone'

		expect(issue_citation.bare_references(message)).toEqual([])
	})

	it('ignores a #N inside an inline-code span', () => {
		expect(issue_citation.bare_references('the example `closes #34` is fine')).toEqual([])
	})

	it('ignores a #N on a quote line', () => {
		expect(issue_citation.bare_references('quoting the body:\n> fixes #56 later')).toEqual([])
	})

	it('ignores a #N read as a PR reference', () => {
		expect(issue_citation.bare_references('landed in PR #78')).toEqual([])
		expect(issue_citation.bare_references('see pull request #90')).toEqual([])
	})

	it('still flags a bare #N outside the fence, code, quote and PR cases', () => {
		const message = '```\ncode #1\n```\ntracked by #99'

		expect(issue_citation.bare_references(message)).toEqual(['#99'])
	})

	it('does not read a word merely ending in "pr" as a PR reference', () => {
		expect(issue_citation.bare_references('the expr #5 broke')).toEqual(['#5'])
	})
})

describe('issue_citation.cite_arguments', () => {
	it('strips the # from a bare reference so issue:cite reads a number', () => {
		expect(issue_citation.cite_arguments(['#123', '#456'])).toEqual(['123', '456'])
	})

	it('passes a qualified reference through unchanged', () => {
		expect(issue_citation.cite_arguments([CROSS_REPO_REF])).toEqual([CROSS_REPO_REF])
	})
})
