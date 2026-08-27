import { describe, expect, it } from 'vitest'
import { github_issue_url } from './github-issue-url'

const KIT_ISSUE_URL = 'https://github.com/joshuafolkken/kit/issues/903'
const OTHER_REPO_ISSUE_URL = 'https://github.com/joshuafolkken/joshuafolkken-com/issues/431'

describe('github_issue_url.parse — a well-formed issue URL', () => {
	it('returns the owner, the repository and the issue number', () => {
		expect(github_issue_url.parse(KIT_ISSUE_URL)).toStrictEqual({
			owner: 'joshuafolkken',
			repo: 'kit',
			name_with_owner: 'joshuafolkken/kit',
			issue_number: '903',
		})
	})

	it('reads a repository other than the one the session runs in', () => {
		expect(github_issue_url.parse(OTHER_REPO_ISSUE_URL)?.repo).toBe('joshuafolkken-com')
	})

	it('ignores a trailing anchor or query string', () => {
		expect(github_issue_url.parse(`${KIT_ISSUE_URL}#top`)?.issue_number).toBe('903')
		expect(github_issue_url.parse(`${KIT_ISSUE_URL}?foo=1`)?.issue_number).toBe('903')
	})
})

describe('github_issue_url.parse — anything else', () => {
	it('returns undefined when no URL was given', () => {
		expect(github_issue_url.parse(undefined)).toBeUndefined()
	})

	it('returns undefined for a URL outside github.com', () => {
		expect(github_issue_url.parse('https://example.com/o/r/issues/7')).toBeUndefined()
	})

	it('returns undefined for a pull request URL', () => {
		expect(github_issue_url.parse('https://github.com/o/r/pull/8')).toBeUndefined()
	})

	it('returns undefined for an issue list URL with no number', () => {
		expect(github_issue_url.parse('https://github.com/o/r/issues')).toBeUndefined()
	})

	it('refuses a number that runs into more characters', () => {
		expect(github_issue_url.parse('https://github.com/o/r/issues/431x')).toBeUndefined()
	})
})
