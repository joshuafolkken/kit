import { describe, expect, it } from 'vitest'
import { gh_failure as gh_failure_module } from './git-gh-failure'
import { gh_failure, too_many_files_failure } from './git-gh-pr-fixture'
import { git_gh_pr_too_large } from './git-gh-pr-too-large'

const UNPROCESSABLE_STATUS = 422
const BAD_REQUEST_STATUS = 400

describe('git_gh_pr_too_large.is_too_many_files', () => {
	it('answers true for the 422 GitHub sends a too-large pull request', () => {
		expect(git_gh_pr_too_large.is_too_many_files(too_many_files_failure())).toBe(true)
	})

	it.each([
		['another status with the same text', too_many_files_failure(BAD_REQUEST_STATUS)],
		[
			'a 422 about something else',
			gh_failure_module.attach(gh_failure(), { status: UNPROCESSABLE_STATUS }),
		],
		['a failure gh never classified', gh_failure()],
		['something that is not an error', 'too many files changed'],
	])('answers false for %s', (_label, error) => {
		expect(git_gh_pr_too_large.is_too_many_files(error)).toBe(false)
	})
})
