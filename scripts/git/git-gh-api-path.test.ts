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

describe('issues_api_path', () => {
	it('builds the issue collection under the current repository', () => {
		expect(git_gh_api_path.issues_api_path()).toBe(`${CURRENT_REPO_PATH}/issues`)
	})

	it('builds the issue collection under another repository', () => {
		expect(git_gh_api_path.issues_api_path(REPO)).toBe(`repos/${REPO}/issues`)
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

	// The listing, the reads and the writes all name the same collection segment, so one issue's path
	// is built on it rather than spelling `/issues` out again (joshuafolkken/kit#1026).
	it('builds the issue path on top of the issue collection', () => {
		expect(git_gh_api_path.issue_api_path('7', REPO)).toBe(
			`${git_gh_api_path.issues_api_path(REPO)}/7`,
		)
	})
})

describe('blocked_by_api_path', () => {
	it('builds the dependencies endpoint under the current repository', () => {
		expect(git_gh_api_path.blocked_by_api_path('1')).toBe(
			`${CURRENT_REPO_PATH}/issues/1/dependencies/blocked_by`,
		)
	})

	// The read appends a page size and the two writes do not, so only the segment is shared — which is
	// why it is a path builder rather than a string constant (joshuafolkken/kit#1026).
	it('builds the dependencies endpoint on top of the issue path', () => {
		expect(git_gh_api_path.blocked_by_api_path('7', REPO)).toBe(
			`${git_gh_api_path.issue_api_path('7', REPO)}/dependencies/blocked_by`,
		)
	})
})

// The merge gate's snapshot reads three endpoints `gh pr view` hid behind one GraphQL query, and two
// of them hang off the head *commit* rather than off the pull request (joshuafolkken/kit#1028).
describe('pull_reviews_api_path', () => {
	it('builds the review listing on top of the pull request path', () => {
		expect(git_gh_api_path.pull_reviews_api_path('7', REPO)).toBe(
			`${git_gh_api_path.pull_api_path('7', REPO)}/reviews`,
		)
	})
})

describe('commit_check_runs_api_path', () => {
	it('keys the check runs on a commit under the current repository', () => {
		expect(git_gh_api_path.commit_check_runs_api_path('abc123')).toBe(
			`${CURRENT_REPO_PATH}/commits/abc123/check-runs`,
		)
	})
})

describe('commit_status_api_path', () => {
	it('keys the combined status on a commit under the current repository', () => {
		expect(git_gh_api_path.commit_status_api_path('abc123')).toBe(
			`${CURRENT_REPO_PATH}/commits/abc123/status`,
		)
	})

	// Two endpoints on one commit, so the shared segment is a builder rather than two literals.
	it('shares the commit segment with the check run path', () => {
		expect(git_gh_api_path.commit_status_api_path('abc123', REPO)).toBe(
			`${git_gh_api_path.commit_api_path('abc123', REPO)}/status`,
		)
	})
})
