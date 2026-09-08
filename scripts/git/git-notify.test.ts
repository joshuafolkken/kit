import { describe, expect, it } from 'vitest'
import { git_notify } from './git-notify'

const DEFAULT_MESSAGE = 'Implementation is complete. Please review.'
const TARGET_PR = 'pr'

describe('git_notify.build_notify_config — valid targets', () => {
	it('returns config with target pr', () => {
		const result = git_notify.build_notify_config({
			raw_target: TARGET_PR,
			raw_message: undefined,
			raw_mentions: undefined,
		})

		expect(result?.target).toBe(TARGET_PR)
	})

	it('returns undefined when target is undefined', () => {
		expect(
			git_notify.build_notify_config({
				raw_target: undefined,
				raw_message: undefined,
				raw_mentions: undefined,
			}),
		).toBeUndefined()
	})

	it('throws for invalid target', () => {
		expect(() =>
			git_notify.build_notify_config({
				raw_target: 'invalid',
				raw_message: undefined,
				raw_mentions: undefined,
			}),
		).toThrow('Invalid notify target')
	})
})

describe('git_notify.build_notify_config — message and mentions', () => {
	it('uses default message when raw_message is undefined', () => {
		const result = git_notify.build_notify_config({
			raw_target: 'issue',
			raw_message: undefined,
			raw_mentions: undefined,
		})

		expect(result?.message).toBe(DEFAULT_MESSAGE)
	})

	it('normalizes mentions with @ prefix', () => {
		const result = git_notify.build_notify_config({
			raw_target: 'both',
			raw_message: 'done',
			raw_mentions: 'user1, @user2',
		})

		expect(result?.mentions).toEqual(['@user1', '@user2'])
	})

	// joshuafolkken/kit#1198 moved the `\n` expansion to `cli_body`, where the flag is read: a message
	// arriving from `--notify-message-file` already holds real newlines, so a literal backslash-n in
	// one is the author's text. Expanding it here would rewrite it, and the escape's own coverage now
	// lives in `scripts/josh/cli-body.test.ts`.
	it(String.raw`keeps a literal \n in the message it was handed`, () => {
		const result = git_notify.build_notify_config({
			raw_target: TARGET_PR,
			raw_message: String.raw`line1\nline2`,
			raw_mentions: undefined,
		})

		expect(result?.message).toBe(String.raw`line1\nline2`)
	})

	it('trims surrounding whitespace', () => {
		const result = git_notify.build_notify_config({
			raw_target: TARGET_PR,
			raw_message: '  done  ',
			raw_mentions: undefined,
		})

		expect(result?.message).toBe('done')
	})
})

describe('git_notify.build_completion_comment_body', () => {
	it('formats body with message, issue, pr url, and mentions', () => {
		const body = git_notify.build_completion_comment_body({
			message: 'Done',
			issue_number: '42',
			pr_url: 'https://example.com/pr/1',
			mentions: ['@user'],
		})

		expect(body).toContain('✅ Done')
		expect(body).toContain('Issue: #42')
		expect(body).toContain('PR: https://example.com/pr/1')
		expect(body).toContain('@user')
	})

	it('omits issue and pr lines when both are undefined', () => {
		const body = git_notify.build_completion_comment_body({
			message: 'Done',
			issue_number: undefined,
			pr_url: undefined,
			mentions: [],
		})

		expect(body).not.toContain('Issue:')
		expect(body).not.toContain('PR:')
	})
})
