import { describe, expect, it } from 'vitest'
import {
	build_telegram_input,
	has_closes_keyword,
	is_blank_issue_body,
	parse_repo_name,
	type TelegramContext,
} from './git-pr-followup'

// The pure half of `git-pr-followup`: functions that answer from their arguments alone. Kept apart
// from the run tests, which need the whole `gh` surface mocked before the module is even imported.

describe('is_blank_issue_body', () => {
	it('returns true for undefined', () => {
		expect(is_blank_issue_body(undefined)).toBe(true)
	})

	it('returns true for empty string', () => {
		expect(is_blank_issue_body('')).toBe(true)
	})

	it('returns true for whitespace-only string', () => {
		expect(is_blank_issue_body('   \n\t  ')).toBe(true)
	})

	it('returns false for non-empty body', () => {
		expect(is_blank_issue_body('## Background\nSome content')).toBe(false)
	})

	it('returns false for body with leading whitespace and content', () => {
		expect(is_blank_issue_body('  content  ')).toBe(false)
	})
})

describe('has_closes_keyword', () => {
	it('returns false for undefined', () => {
		expect(has_closes_keyword(undefined)).toBe(false)
	})

	it('returns true for "closes #123"', () => {
		expect(has_closes_keyword('closes #123')).toBe(true)
	})

	it('returns true case-insensitively for "Closes #42"', () => {
		expect(has_closes_keyword('Closes #42')).toBe(true)
	})

	it('returns true when closes keyword appears in a multi-line body', () => {
		expect(has_closes_keyword('## Summary\nSome text\n\ncloses #7\n')).toBe(true)
	})

	it('returns false when body has no closes keyword', () => {
		expect(has_closes_keyword('## Summary\nSome unrelated text')).toBe(false)
	})
})

describe('parse_repo_name', () => {
	it('returns the repo name from owner/repo format', () => {
		expect(parse_repo_name('joshuafolkken/tasks')).toBe('tasks')
	})

	it('returns undefined when input is undefined', () => {
		const input: string | undefined = undefined

		expect(parse_repo_name(input)).toBeUndefined()
	})
})

describe('build_telegram_input', () => {
	const CONTEXT: TelegramContext = {
		repo_name: 'joshuafolkken-com',
		issue_title: 'Fix bug',
		issue_url: 'https://github.com/owner/repo/issues/1',
		pr_url: 'https://github.com/owner/repo/pull/2',
	}

	it('forwards context fields and task_type onto the send input', () => {
		const result = build_telegram_input({
			task_type: 'completion',
			context: CONTEXT,
			body: undefined,
		})

		expect(result).toStrictEqual({
			task_type: 'completion',
			repo_name: CONTEXT.repo_name,
			issue_title: CONTEXT.issue_title,
			body: undefined,
			issue_url: CONTEXT.issue_url,
			pr_url: CONTEXT.pr_url,
		})
	})
})
