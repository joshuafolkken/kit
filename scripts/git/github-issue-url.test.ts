import { describe, expect, it } from 'vitest'
import { github_issue_url } from './github-issue-url'

const KIT_ISSUE_URL = 'https://github.com/joshuafolkken/kit/issues/903'
const OTHER_REPO_ISSUE_URL = 'https://github.com/joshuafolkken/joshuafolkken-com/issues/431'
const KIT_PULL_URL = 'https://github.com/joshuafolkken/kit/pull/995'
const OTHER_REPO_PULL_URL = 'https://github.com/joshuafolkken/joshuafolkken-com/pull/12'
const KIT_BASE_URL = 'https://github.com/joshuafolkken/kit'
const OTHER_REPO_NAME = 'joshuafolkken-com'
const KIT_NAME_WITH_OWNER = 'joshuafolkken/kit'
const KIT_OWNER = 'joshuafolkken'
const KIT_REPO = 'kit'

describe('github_issue_url.parse — a well-formed issue URL', () => {
	it('returns the owner, the repository and the issue number', () => {
		expect(github_issue_url.parse(KIT_ISSUE_URL)).toStrictEqual({
			owner: KIT_OWNER,
			repo: KIT_REPO,
			name_with_owner: KIT_NAME_WITH_OWNER,
			base_url: KIT_BASE_URL,
			issue_number: '903',
		})
	})

	it('reads a repository other than the one the session runs in', () => {
		expect(github_issue_url.parse(OTHER_REPO_ISSUE_URL)?.repo).toBe(OTHER_REPO_NAME)
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

// joshuafolkken/kit#994: a notification carrying only a pull-request URL was still filed under the
// working directory's repository, because only the issue form was read. The pull form lives here
// rather than beside the issue form so the two cannot drift apart.
describe('github_issue_url.parse_pull — a well-formed pull-request URL', () => {
	it('returns the owner, the repository and the number', () => {
		expect(github_issue_url.parse_pull(KIT_PULL_URL)).toStrictEqual({
			owner: KIT_OWNER,
			repo: KIT_REPO,
			name_with_owner: KIT_NAME_WITH_OWNER,
			base_url: KIT_BASE_URL,
			pull_number: '995',
		})
	})

	it('reads a pull request in a repository other than the one the session runs in', () => {
		expect(github_issue_url.parse_pull(OTHER_REPO_PULL_URL)?.repo).toBe(OTHER_REPO_NAME)
	})

	// The pattern the pull form replaced was anchored to the end of the string, so a link copied
	// from a file view read as nothing at all. The repository it names is the same either way.
	it('reads a URL that continues past the number', () => {
		expect(github_issue_url.parse_pull(`${KIT_PULL_URL}/files`)?.name_with_owner).toBe(
			KIT_NAME_WITH_OWNER,
		)
	})

	it('ignores an anchor or query string after the pull number', () => {
		expect(github_issue_url.parse_pull(`${KIT_PULL_URL}#top`)?.pull_number).toBe('995')
		expect(github_issue_url.parse_pull(`${KIT_PULL_URL}?foo=1`)?.pull_number).toBe('995')
	})
})

describe('github_issue_url.parse_pull — anything else', () => {
	it('returns undefined when no pull URL was given', () => {
		expect(github_issue_url.parse_pull(undefined)).toBeUndefined()
	})

	// The two forms stay apart: reading an issue URL as a pull request would name the right
	// repository for the wrong reason, and hide a caller passing the wrong flag.
	it('refuses an issue URL', () => {
		expect(github_issue_url.parse_pull(KIT_ISSUE_URL)).toBeUndefined()
	})

	it('refuses a pull URL with no number', () => {
		expect(
			github_issue_url.parse_pull('https://github.com/joshuafolkken/kit/pull/'),
		).toBeUndefined()
	})

	it('refuses a non-github host', () => {
		expect(
			github_issue_url.parse_pull('https://example.com/joshuafolkken/kit/pull/995'),
		).toBeUndefined()
	})
})
