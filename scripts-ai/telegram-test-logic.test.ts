import { describe, expect, it } from 'vitest'
import { telegram_test_logic, type ResolvedContext } from './telegram-test-logic'

const EMPTY_CONTEXT: ResolvedContext = {
	repo_name: undefined,
	issue_title: undefined,
}
const FALLBACK_REPO = 'fallback-repo'
const FALLBACK_TITLE = 'fallback title'
const AUTO_REPO = 'auto-repo'
const AUTO_TITLE = 'auto title'
const OVERRIDE_REPO = 'my-repo'
const OVERRIDE_TITLE = 'Do the thing'
const OVERRIDE_BODY = '- step 1'
const OVERRIDE_ISSUE_URL = 'https://github.com/o/r/issues/7'
const OVERRIDE_PR_URL = 'https://github.com/o/r/pull/8'

describe('telegram_test_logic.parse_task_type', () => {
	it('returns the default (planning) when undefined', () => {
		// eslint-disable-next-line unicorn/no-useless-undefined -- explicitly testing default fallback
		expect(telegram_test_logic.parse_task_type(undefined)).toBe('planning')
	})

	it('accepts all valid task types', () => {
		expect(telegram_test_logic.parse_task_type('completion')).toBe('completion')
		expect(telegram_test_logic.parse_task_type('failure')).toBe('failure')
		expect(telegram_test_logic.parse_task_type('kickoff_retry')).toBe('kickoff_retry')
		expect(telegram_test_logic.parse_task_type('confirmation')).toBe('confirmation')
	})

	it('throws for invalid task types', () => {
		expect(() => telegram_test_logic.parse_task_type('bogus')).toThrow(/Invalid --task-type/u)
	})
})

describe('telegram_test_logic.parse_issue_number', () => {
	it('extracts the issue number from a GitHub issue URL', () => {
		expect(
			telegram_test_logic.parse_issue_number(
				'https://github.com/joshuafolkken/joshuafolkken-com/issues/431',
			),
		).toBe('431')
	})

	it('returns undefined when the URL does not match', () => {
		expect(
			telegram_test_logic.parse_issue_number('https://example.com/not-an-issue'),
		).toBeUndefined()
	})

	it('returns undefined when the URL is undefined', () => {
		// eslint-disable-next-line unicorn/no-useless-undefined -- explicitly testing undefined input
		expect(telegram_test_logic.parse_issue_number(undefined)).toBeUndefined()
	})
})

describe('telegram_test_logic.build_input — explicit flags win', () => {
	it('uses CLI overrides when provided', () => {
		const result = telegram_test_logic.build_input({
			values: {
				'task-type': 'completion',
				'repo-name': OVERRIDE_REPO,
				'issue-title': OVERRIDE_TITLE,
				body: OVERRIDE_BODY,
				'issue-url': OVERRIDE_ISSUE_URL,
				'pr-url': OVERRIDE_PR_URL,
			},
			context: { repo_name: FALLBACK_REPO, issue_title: FALLBACK_TITLE },
		})

		expect(result).toStrictEqual({
			task_type: 'completion',
			repo_name: OVERRIDE_REPO,
			issue_title: OVERRIDE_TITLE,
			body: OVERRIDE_BODY,
			issue_url: OVERRIDE_ISSUE_URL,
			pr_url: OVERRIDE_PR_URL,
		})
	})
})

describe('telegram_test_logic.build_input — body normalization', () => {
	it('converts escaped newline sequences in body to real newlines', () => {
		const result = telegram_test_logic.build_input({
			values: { body: String.raw`- step 1\n- step 2\n- step 3` },
			context: EMPTY_CONTEXT,
		})

		expect(result.body).toBe(`- step 1\n- step 2\n- step 3`)
	})

	it('leaves body undefined when not provided', () => {
		const result = telegram_test_logic.build_input({
			values: {},
			context: EMPTY_CONTEXT,
		})

		expect(result.body).toBeUndefined()
	})
})

describe('telegram_test_logic.build_input — resolved context fallback', () => {
	it('falls back to resolved context when flags are missing', () => {
		const result = telegram_test_logic.build_input({
			values: {},
			context: { repo_name: AUTO_REPO, issue_title: AUTO_TITLE },
		})

		expect(result.task_type).toBe('planning')
		expect(result.repo_name).toBe(AUTO_REPO)
		expect(result.issue_title).toBe(AUTO_TITLE)
		expect(result.body).toBeUndefined()
	})

	it('leaves undefined when both flag and context are missing', () => {
		const result = telegram_test_logic.build_input({
			values: {},
			context: EMPTY_CONTEXT,
		})

		expect(result.repo_name).toBeUndefined()
		expect(result.issue_title).toBeUndefined()
	})
})
