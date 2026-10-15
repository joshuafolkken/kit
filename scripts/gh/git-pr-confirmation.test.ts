import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_pr_confirmation, has_ignore_reason, type TelegramContext } from './git-pr-confirmation'

vi.mock('#scripts/notify/telegram-notify', () => ({
	telegram_notify: { send_or_report: vi.fn() },
}))

const { telegram_notify } = await import('#scripts/notify/telegram-notify')
const mocked_send_or_report = vi.mocked(telegram_notify.send_or_report)

const CONTEXT: TelegramContext = {
	repo_name: 'joshuafolkken/kit',
	issue_title: 'Add a thing',
	issue_url: 'https://github.com/joshuafolkken/kit/issues/1',
	pr_url: 'https://github.com/joshuafolkken/kit/pull/2',
}
const BODY = 'The review found a blocker.'
const RECOMMENDED = 'Fix the findings'
const ALTERNATIVE = 'Pass an ignore reason'
const INPUT = {
	context: CONTEXT,
	body: BODY,
	recommended: RECOMMENDED,
	alternatives: [ALTERNATIVE],
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.stubEnv('JOSH_SESSION_LANG', 'en')
	mocked_send_or_report.mockResolvedValue(true)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('notify_confirmation', () => {
	it('sends a confirmation carrying every context field, the body and the choices', async () => {
		await git_pr_confirmation.notify_confirmation(INPUT)

		expect(mocked_send_or_report).toHaveBeenCalledWith(
			{
				task_type: 'confirmation',
				...CONTEXT,
				body: BODY,
				choices: `Recommended: ${RECOMMENDED}\nAlternatives:\n- ${ALTERNATIVE}`,
			},
			expect.any(String),
		)
	})

	it('names the by-hand --body-file recovery for a send that fails', async () => {
		await git_pr_confirmation.notify_confirmation(INPUT)

		const recovery = mocked_send_or_report.mock.calls[0]?.[1]

		expect(recovery).toContain('pnpm josh notify --task-type confirmation')
		expect(recovery).toContain('--body-file')
		expect(recovery).toContain('--recommended')
	})

	it('resolves even when the send reports a failure', async () => {
		mocked_send_or_report.mockResolvedValue(false)

		await expect(git_pr_confirmation.notify_confirmation(INPUT)).resolves.toBeUndefined()
	})
})

describe('has_ignore_reason', () => {
	it('accepts a reason with text', () => {
		expect(has_ignore_reason('false positive, see thread')).toBe(true)
	})

	it.each([undefined, '', ' '.repeat(3), '\n\t'])('refuses %j as no reason at all', (reason) => {
		expect(has_ignore_reason(reason)).toBe(false)
	})
})
