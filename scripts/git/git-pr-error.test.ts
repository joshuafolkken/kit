import { describe, expect, it } from 'vitest'
import { git_pr_error } from './git-pr-error'

const PR_ALREADY_EXISTS = 'PR_ALREADY_EXISTS'

describe('git_pr_error.is_pr_already_exists_error', () => {
	it('returns true when error message is PR_ALREADY_EXISTS', () => {
		expect(git_pr_error.is_pr_already_exists_error(new Error(PR_ALREADY_EXISTS))).toBe(true)
	})

	it('returns true when error cause message is PR_ALREADY_EXISTS', () => {
		const inner = new Error(PR_ALREADY_EXISTS)
		const outer = new Error('wrapped', { cause: inner })

		expect(git_pr_error.is_pr_already_exists_error(outer)).toBe(true)
	})

	it('returns false for unrelated error messages', () => {
		expect(git_pr_error.is_pr_already_exists_error(new Error('network timeout'))).toBe(false)
	})

	it('returns false for non-Error values', () => {
		expect(git_pr_error.is_pr_already_exists_error(PR_ALREADY_EXISTS)).toBe(false)
		expect(git_pr_error.is_pr_already_exists_error(0)).toBe(false)
	})

	it('returns false when cause is not an Error', () => {
		const error = new Error('outer') as Error & { cause: string }

		error.cause = PR_ALREADY_EXISTS

		expect(git_pr_error.is_pr_already_exists_error(error)).toBe(false)
	})
})
