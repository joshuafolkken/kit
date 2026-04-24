import { describe, expect, it } from 'vitest'
import { build_text, telegram_environment_schema, type TelegramSendInput } from './telegram-notify'

const ISSUE_URL = 'https://github.com/owner/repo/issues/1'
const BOT_TOKEN = 'bot-token-123'
const CHAT_ID = 'chat-456'
const PR_URL = 'https://github.com/owner/repo/pull/2'
const REPO_NAME = 'joshuafolkken-com'
const ISSUE_TITLE = 'Fix something important'
const BODY = '- Added foo\n- Changed bar'

function make_base(overrides: Partial<TelegramSendInput>): TelegramSendInput {
	return {
		task_type: 'planning',
		repo_name: REPO_NAME,
		issue_title: ISSUE_TITLE,
		body: undefined,
		issue_url: undefined,
		pr_url: undefined,
		...overrides,
	}
}

describe('build_text — planning header', () => {
	it('uses 📋 + Planning label', () => {
		const result = build_text(make_base({ task_type: 'planning' }))

		expect(result).toBe(`📋 ${REPO_NAME}: Planning\n${ISSUE_TITLE}`)
	})
})

describe('build_text — completion header', () => {
	it('uses ✅ + Completion label', () => {
		const result = build_text(make_base({ task_type: 'completion' }))

		expect(result).toBe(`✅ ${REPO_NAME}: Completion\n${ISSUE_TITLE}`)
	})
})

describe('build_text — failure header', () => {
	it('uses ❌ + Failure label', () => {
		const result = build_text(make_base({ task_type: 'failure' }))

		expect(result).toBe(`❌ ${REPO_NAME}: Failure\n${ISSUE_TITLE}`)
	})
})

describe('build_text — kickoff_retry header', () => {
	it('uses 🔄 + Kickoff retry label', () => {
		const result = build_text(make_base({ task_type: 'kickoff_retry' }))

		expect(result).toBe(`🔄 ${REPO_NAME}: Kickoff retry\n${ISSUE_TITLE}`)
	})
})

describe('build_text — confirmation header', () => {
	it('uses ⏸️ + Confirmation required label', () => {
		const result = build_text(make_base({ task_type: 'confirmation' }))

		expect(result).toBe(`⏸️ ${REPO_NAME}: Confirmation required\n${ISSUE_TITLE}`)
	})
})

describe('build_text — body and URL blocks', () => {
	it('separates body from issue title with a blank line, URLs as separated blocks', () => {
		const result = build_text(
			make_base({
				task_type: 'planning',
				body: BODY,
				issue_url: ISSUE_URL,
				pr_url: PR_URL,
			}),
		)

		expect(result).toBe(
			`📋 ${REPO_NAME}: Planning\n${ISSUE_TITLE}\n\n${BODY}\n\nIssue: ${ISSUE_URL}\n\nPR: ${PR_URL}`,
		)
	})

	it('omits Issue line when issue_url is undefined', () => {
		const result = build_text(make_base({ task_type: 'completion', pr_url: PR_URL }))

		expect(result).toBe(`✅ ${REPO_NAME}: Completion\n${ISSUE_TITLE}\n\nPR: ${PR_URL}`)
	})
})

describe('build_text — failure report layout', () => {
	it('separates the failure body from the issue title with a blank line', () => {
		const failure_body = 'CI check failed:\nRequired check X failed'
		const result = build_text(make_base({ task_type: 'failure', body: failure_body }))

		expect(result).toBe(`❌ ${REPO_NAME}: Failure\n${ISSUE_TITLE}\n\n${failure_body}`)
	})
})

describe('build_text — header fallback when context missing', () => {
	it('omits "<repo>:" when repo_name is undefined', () => {
		const result = build_text(make_base({ task_type: 'failure', repo_name: undefined }))

		expect(result).toBe(`❌ Failure\n${ISSUE_TITLE}`)
	})

	it('omits issue title line when issue_title is undefined', () => {
		const result = build_text(make_base({ task_type: 'completion', issue_title: undefined }))

		expect(result).toBe(`✅ ${REPO_NAME}: Completion`)
	})
})

describe('telegram_environment_schema', () => {
	it('validates successfully when both tokens are non-empty', () => {
		const result = telegram_environment_schema.safeParse({
			telegram_bot_token: BOT_TOKEN,
			telegram_chat_id: CHAT_ID,
		})

		expect(result.success).toBe(true)
	})

	it('fails with TELEGRAM_BOT_TOKEN message when bot token is empty', () => {
		const result = telegram_environment_schema.safeParse({
			telegram_bot_token: '',
			telegram_chat_id: CHAT_ID,
		})

		expect(result.success).toBe(false)
		expect(result.error?.issues.at(0)?.message).toContain('TELEGRAM_BOT_TOKEN')
	})

	it('fails with TELEGRAM_CHAT_ID message when chat id is empty', () => {
		const result = telegram_environment_schema.safeParse({
			telegram_bot_token: BOT_TOKEN,
			telegram_chat_id: '',
		})

		expect(result.success).toBe(false)
		expect(result.error?.issues.at(0)?.message).toContain('TELEGRAM_CHAT_ID')
	})
})
