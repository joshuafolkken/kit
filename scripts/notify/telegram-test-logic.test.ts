import { afterEach, describe, expect, it, vi } from 'vitest'
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
		expect(telegram_test_logic.parse_task_type(undefined)).toBe('planning')
	})

	it('accepts all valid task types', () => {
		expect(telegram_test_logic.parse_task_type('completion')).toBe('completion')
		expect(telegram_test_logic.parse_task_type('failure')).toBe('failure')
		expect(telegram_test_logic.parse_task_type('warning')).toBe('warning')
		expect(telegram_test_logic.parse_task_type('kickoff_retry')).toBe('kickoff_retry')
		expect(telegram_test_logic.parse_task_type('confirmation')).toBe('confirmation')
	})

	it('throws for invalid task types', () => {
		expect(() => telegram_test_logic.parse_task_type('bogus')).toThrow(/Invalid --task-type/u)
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
			choices: undefined,
			reason: undefined,
			issue: OVERRIDE_ISSUE_URL,
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

// joshuafolkken/kit#3861: a confirmation names the recommended choice and the others.
describe('telegram_test_logic.build_input — confirmation choices', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('refuses a confirmation without --recommended', () => {
		expect(() =>
			telegram_test_logic.build_input({
				values: { 'task-type': 'confirmation', body: OVERRIDE_BODY, recommended: ' ' },
				context: EMPTY_CONTEXT,
			}),
		).toThrow(/--recommended/u)
	})

	it('carries the recommended choice and every --alternative beside the body', () => {
		vi.stubEnv('JOSH_SESSION_LANG', 'en')
		const result = telegram_test_logic.build_input({
			values: {
				'task-type': 'confirmation',
				body: OVERRIDE_BODY,
				recommended: 'Resume',
				alternative: ['Wait', 'Close'],
			},
			context: EMPTY_CONTEXT,
		})

		expect(result.body).toBe(OVERRIDE_BODY)
		expect(result.choices).toBe('Recommended: Resume\nAlternatives:\n- Wait\n- Close')
	})

	it('leaves the body of any other type untouched and carries no choices', () => {
		const result = telegram_test_logic.build_input({
			values: { 'task-type': 'failure', body: OVERRIDE_BODY },
			context: EMPTY_CONTEXT,
		})

		expect(result.body).toBe(OVERRIDE_BODY)
		expect(result.choices).toBeUndefined()
	})
})

// joshuafolkken/kit#7889: the reason the confirmation ledger counts is a registered key.
function reason_of(reason: string | undefined): unknown {
	const given = reason === undefined ? {} : { reason }
	const values = { 'task-type': 'confirmation', recommended: 'Resume', ...given }

	return telegram_test_logic.build_input({ values, context: EMPTY_CONTEXT }).reason
}

describe('telegram_test_logic.build_input — --reason', () => {
	it('passes a registered human-stop key through', () => {
		const key = 'merge-approval'

		expect(reason_of(key)).toBe(key)
	})

	it('leaves the reason unset when the flag is absent', () => {
		expect(reason_of(undefined)).toBeUndefined()
	})

	it('refuses a reason the registry does not hold', () => {
		expect(() => reason_of('just-curious')).toThrow(/Invalid --reason: just-curious/u)
	})

	it('names the Issue for the ledger by the --issue-url it was given', () => {
		const url = 'https://github.com/joshuafolkken/kit/issues/7889'
		const values = { 'task-type': 'confirmation', recommended: 'Resume', 'issue-url': url }

		expect(telegram_test_logic.build_input({ values, context: EMPTY_CONTEXT }).issue).toBe(url)
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
