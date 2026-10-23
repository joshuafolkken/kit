import { token_shape_fixture } from '#scripts/lib/token-shape-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { telegram_notify, type TelegramSendInput } from './telegram-notify'

// joshuafolkken/kit#4658: Telegram is a third-party service, so a message holding a credential is
// refused before it is posted — the whole text is read, ahead of the cut to Telegram's limit.

const TEXT_LIMIT_OVERFLOW = 5000

function make_input(body: string): TelegramSendInput {
	return {
		task_type: 'failure',
		repo_name: 'kit',
		issue_title: 'Gate failed',
		body,
		issue_url: undefined,
		pr_url: undefined,
	}
}

function stub_telegram(): ReturnType<typeof vi.fn> {
	const fetch_mock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })

	vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token-123')
	vi.stubEnv('TELEGRAM_CHAT_ID', 'chat-456')
	vi.stubEnv('JOSH_NOTIFY', undefined)
	vi.stubGlobal('fetch', fetch_mock)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)

	return fetch_mock
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('telegram_notify.send — a message holding a credential', () => {
	it.each(['Anthropic API key', 'Slack token'])('refuses a %s and posts nothing', async (name) => {
		const fetch_mock = stub_telegram()
		const body = `stderr: ${token_shape_fixture.sample_of(name)}`

		await expect(telegram_notify.send(make_input(body))).rejects.toThrow(
			`The Telegram message holds a ${name}-shaped string`,
		)
		expect(fetch_mock).not.toHaveBeenCalled()
	})

	it('refuses a credential past the length the message is cut to', async () => {
		const fetch_mock = stub_telegram()
		const sample = token_shape_fixture.sample_of('GitHub token')
		const body = `${'x'.repeat(TEXT_LIMIT_OVERFLOW)}\n${sample}`

		await expect(telegram_notify.send(make_input(body))).rejects.toThrow('GitHub token-shaped')
		expect(fetch_mock).not.toHaveBeenCalled()
	})

	it('posts a message holding none', async () => {
		const fetch_mock = stub_telegram()

		await telegram_notify.send(make_input('stderr: exit 1'))

		expect(fetch_mock).toHaveBeenCalledOnce()
	})
})
