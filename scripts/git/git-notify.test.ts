import { describe, expect, it } from 'vitest'
import { git_notify } from './git-notify'

const DEFAULT_MESSAGE = 'Implementation is complete. Please review.'
const TARGET_PR = 'pr'
// A message whose own escape produced the newlines at either end. Named because the assertion has to
// be the same string as the input: what is pinned is that nothing between the two removes them.
const EDGE_NEWLINE_MESSAGE = '\nline1\nline2\n'

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
})

// **Trimming moved up with the expansion, and for the same reason.** This function used to read
// `raw.trim().replaceAll(…)` — trim first, expand second. Keeping the trim here once the expansion
// had moved reversed that order, so `--notify-message "…\n"` lost the newline its own escape had just
// produced. The quoting slack is now removed by `cli_body` before the escape is expanded
// (`scripts/josh/cli-body.test.ts`), and what arrives here is passed on as it stands.
describe('git_notify.build_notify_config — the message is passed on as it stands', () => {
	it('keeps the newlines at either end of the message it was handed', () => {
		const result = git_notify.build_notify_config({
			raw_target: TARGET_PR,
			raw_message: EDGE_NEWLINE_MESSAGE,
			raw_mentions: undefined,
		})

		expect(result?.message).toBe(EDGE_NEWLINE_MESSAGE)
	})

	// The negative control: `trim` survives as the emptiness test, where the whitespace is counted
	// rather than removed, so a message of nothing but spaces is still no answer.
	it('falls back to the default when the message is only whitespace', () => {
		const result = git_notify.build_notify_config({
			raw_target: TARGET_PR,
			raw_message: '  \n  ',
			raw_mentions: undefined,
		})

		expect(result?.message).toBe(DEFAULT_MESSAGE)
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
