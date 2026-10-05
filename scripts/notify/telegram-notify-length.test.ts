import { describe, expect, it } from 'vitest'
import { build_text, type TelegramSendInput } from './telegram-notify'

const TELEGRAM_TEXT_LIMIT = 4096
const LONG_BODY_REPEAT = 2000
const ISSUE_URL = 'https://github.com/owner/repo/issues/1'
const CAUSE = 'error spawn git ENOENT'

function make_input(body: string): TelegramSendInput {
	return {
		task_type: 'warning',
		repo_name: 'kit',
		issue_title: 'Supervisor stopped',
		body,
		issue_url: ISSUE_URL,
		pr_url: undefined,
	}
}

describe('build_text — Telegram length limit', () => {
	it('cuts a long body to fit the limit, keeping its first line and the URL', () => {
		const result = build_text(make_input(`${CAUSE}\n${'stderr line\n'.repeat(LONG_BODY_REPEAT)}`))

		expect(result).toHaveLength(TELEGRAM_TEXT_LIMIT)
		expect(result).toContain(`\n\n${CAUSE}\n`)
		expect(result.endsWith(`\n...\n\nIssue: ${ISSUE_URL}`)).toBe(true)
	})

	// One of the two offsets puts the cut between the halves of a surrogate pair.
	it.each(['', 'x'])('never leaves a lone surrogate at the cut (offset %j)', (offset) => {
		const result = build_text(make_input(`${offset}${'📱'.repeat(LONG_BODY_REPEAT)}`))

		expect(result.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT)
		expect(() => encodeURIComponent(result)).not.toThrow()
	})

	it('leaves a body within the limit untouched', () => {
		const result = build_text(make_input(CAUSE))

		expect(result).toBe(
			`⚠️ kit: Completed with a warning\nSupervisor stopped\n\n${CAUSE}\n\nIssue: ${ISSUE_URL}`,
		)
	})
})
