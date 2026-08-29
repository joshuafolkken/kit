import { describe, expect, it } from 'vitest'
import { git_gh_api_path } from './git-gh-api-path'

const REPO = 'joshuafolkken/kit'
const CURRENT_REPO_PATH = 'repos/{owner}/{repo}'

describe('repo_api_path', () => {
	// `gh api` expands the placeholders from the current repository, so the unqualified form needs no
	// lookup — which is what keeps the repository-name read itself from needing a repository name.
	it('leaves the repository for gh to expand when none is named', () => {
		expect(git_gh_api_path.repo_api_path()).toBe(CURRENT_REPO_PATH)
	})

	it('names another repository when one is given', () => {
		expect(git_gh_api_path.repo_api_path(REPO)).toBe(`repos/${REPO}`)
	})
})

describe('issue_api_path', () => {
	it('builds an issue path under the current repository', () => {
		expect(git_gh_api_path.issue_api_path('1')).toBe(`${CURRENT_REPO_PATH}/issues/1`)
	})

	it('builds an issue path under another repository', () => {
		expect(git_gh_api_path.issue_api_path('42', REPO)).toBe(`repos/${REPO}/issues/42`)
	})

	// The two share one prefix rather than each spelling out the `repo ?? '{owner}/{repo}'` decision.
	it('builds the issue path on top of the repository path', () => {
		expect(git_gh_api_path.issue_api_path('7', REPO)).toBe(
			`${git_gh_api_path.repo_api_path(REPO)}/issues/7`,
		)
	})
})
