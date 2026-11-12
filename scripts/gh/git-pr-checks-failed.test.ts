import { describe, expect, it } from 'vitest'
import { git_pr_checks_failed } from './git-pr-checks-failed'

// joshuafolkken/kit#7333: one parser of the failed checks a wait reported, for `lane:why` and the stop record.

describe('git_pr_checks_failed.names_of', () => {
	it('reads every check name of the failure, ended by the closing parenthesis', () => {
		const text = '❌ Error: PR checks failed (failed checks: Unit Tests (3/6), SonarQube).'

		expect(git_pr_checks_failed.names_of(text)).toStrictEqual(['Unit Tests (3/6)', 'SonarQube'])
	})

	it('ends the list at the next reason', () => {
		const text = 'PR checks failed (failed checks: CodeQL; merge conflict).'

		expect(git_pr_checks_failed.names_of(text)).toStrictEqual(['CodeQL'])
	})

	it('reads no name from text that lists no failed checks', () => {
		expect(git_pr_checks_failed.names_of('PR checks failed (merge conflict).')).toStrictEqual([])
	})
})
