import { describe, expect, it } from 'vitest'
import { build_telegram_input, parse_repo_name, type TelegramContext } from './git-pr-followup'

const CONTEXT: TelegramContext = {
	repo_name: 'joshuafolkken-com',
	issue_title: 'Fix bug',
	issue_url: 'https://github.com/owner/repo/issues/1',
	pr_url: 'https://github.com/owner/repo/pull/2',
}

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
