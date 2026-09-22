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
