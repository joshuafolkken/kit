import { describe, expect, it } from 'vitest'
import { issue_cite } from './issue-cite'

// The paste-ready citation line and the token parsing behind `josh issue:cite`
// (joshuafolkken/kit#2220). The cases are what the command must not lose: the link points at the
// right repository, a qualified token names another one, and a token that is not a number is refused
// rather than dropped.

const LOCAL_REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const NUMBER = '2220'

describe('issue_cite.citation_line', () => {
	it('builds the number-link form with the title as the summary', () => {
		expect(issue_cite.citation_line(LOCAL_REPO, NUMBER, 'A title')).toBe(
			`[#${NUMBER}](https://github.com/${LOCAL_REPO}/issues/${NUMBER}) — A title`,
		)
	})
})

// joshuafolkken/kit#3424: the single place the bare form is assembled, for text GitHub renders or a
// program reads.
describe('issue_cite.plain', () => {
	it('prints the bare number', () => {
		expect(issue_cite.plain(Number(NUMBER))).toBe(`#${NUMBER}`)
	})

	it('qualifies the number with a repository when one is named', () => {
		expect(issue_cite.plain(NUMBER, OTHER_REPO)).toBe(`${OTHER_REPO}#${NUMBER}`)
	})
})

// joshuafolkken/kit#2943: the progress listings name an issue through this, so the form a report copies
// is decided by what the listing holds, never left as the bare `#N` the Stop guard sends back.
describe('issue_cite.citer', () => {
	it('cites with the title when the listing holds it', () => {
		const cite = issue_cite.citer(LOCAL_REPO, new Map([[NUMBER, 'A title']]))

		expect(cite(NUMBER)).toBe(issue_cite.citation_line(LOCAL_REPO, NUMBER, 'A title'))
	})

	it('falls back to the number-link when only the repository is known', () => {
		expect(issue_cite.citer(LOCAL_REPO, new Map())(NUMBER)).toBe(
			`[#${NUMBER}](${issue_cite.issue_url(LOCAL_REPO, NUMBER)})`,
		)
	})

	it('keeps the plain number when the repository could not be read', () => {
		expect(issue_cite.citer(undefined, new Map([[NUMBER, 'A title']]))(NUMBER)).toBe(`#${NUMBER}`)
	})
})

// joshuafolkken/kit#3099: a renderer holding one title cites through the same decision `citer` makes.
describe('issue_cite.reference', () => {
	it('cites with the title when one is given', () => {
		expect(issue_cite.reference(LOCAL_REPO, NUMBER, 'A title')).toBe(
			issue_cite.citation_line(LOCAL_REPO, NUMBER, 'A title'),
		)
	})

	it('falls back to the number-link without a title', () => {
		expect(issue_cite.reference(LOCAL_REPO, NUMBER, undefined)).toBe(
			`[#${NUMBER}](${issue_cite.issue_url(LOCAL_REPO, NUMBER)})`,
		)
	})

	it('keeps the plain number without a repository', () => {
		expect(issue_cite.reference(undefined, NUMBER, 'A title')).toBe(`#${NUMBER}`)
	})
})

// Exported so the printing-side `linkify` builds a link the same way rather than restating the URL
// shape (joshuafolkken/kit#2329).
describe('issue_cite.issue_url', () => {
	it('assembles the issues URL for a repository and number', () => {
		expect(issue_cite.issue_url(LOCAL_REPO, NUMBER)).toBe(
			`https://github.com/${LOCAL_REPO}/issues/${NUMBER}`,
		)
	})
})

describe('issue_cite.parse_target', () => {
	it('reads a bare number against the default repository', () => {
		expect(issue_cite.parse_target(NUMBER, undefined)).toEqual({ number: NUMBER, repo: undefined })
	})

	it('accepts a # prefix, since that is what a copied reference carries', () => {
		expect(issue_cite.parse_target(`#${NUMBER}`, undefined)).toEqual({
			number: NUMBER,
			repo: undefined,
		})
	})

	it('applies the default repository to a bare number', () => {
		expect(issue_cite.parse_target('45', OTHER_REPO)).toEqual({ number: '45', repo: OTHER_REPO })
	})

	it('reads an owner/repo#N token as its own repository', () => {
		expect(issue_cite.parse_target(`${OTHER_REPO}#45`, LOCAL_REPO)).toEqual({
			number: '45',
			repo: OTHER_REPO,
		})
	})

	it('refuses a token that is neither a number nor owner/repo#N', () => {
		expect(issue_cite.parse_target('not-a-number', undefined)).toBeUndefined()
	})
})

describe('issue_cite failure lines', () => {
	it('names a missing number with its repository', () => {
		expect(issue_cite.missing_line({ number: '45', repo: OTHER_REPO })).toContain(
			`${OTHER_REPO}#45`,
		)
	})

	it('labels a bare number as #N', () => {
		expect(issue_cite.unreadable_line({ number: NUMBER, repo: undefined })).toContain(`#${NUMBER}`)
	})

	it('names the repository read failure for a bare number with no local repo', () => {
		expect(issue_cite.no_repo_line({ number: NUMBER, repo: undefined })).toContain(
			'could not read this repository',
		)
	})
})
