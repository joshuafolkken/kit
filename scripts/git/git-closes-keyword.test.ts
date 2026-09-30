import { describe, expect, it } from 'vitest'
import { git_closes_keyword } from './git-closes-keyword'

// joshuafolkken/kit#2769: the one `closes #N` reader shared by `followup` and `run:merge`.
describe('git_closes_keyword.parse_closes_issue_number', () => {
	it('reads the number a body closes, in any case', () => {
		expect(git_closes_keyword.parse_closes_issue_number('closes #2761\n\n## Summary')).toBe('2761')
		expect(git_closes_keyword.parse_closes_issue_number('Closes #42')).toBe('42')
	})

	it('answers undefined for a body that closes nothing, or no body', () => {
		expect(git_closes_keyword.parse_closes_issue_number('follows #2761')).toBeUndefined()
		expect(git_closes_keyword.parse_closes_issue_number(undefined)).toBeUndefined()
	})
})
