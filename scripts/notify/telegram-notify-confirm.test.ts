import { gh_spawn } from '#scripts/gh/gh-spawn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmation_ledger } from './confirmation-ledger'
import { telegram_notify, type ConfirmInput } from './telegram-notify'

const OK_STATUS = 200
const BODY = 'The run stopped.'
const RECOMMENDED = 'Resume it'
const ALTERNATIVE = 'Leave it'

const ISSUE = '7889'
const CONFIRM: ConfirmInput = {
	reason: 'run-stopped',
	issue_title: 'backlogrun paused',
	body: BODY,
	recovery: 'none',
	recommended: RECOMMENDED,
	alternatives: [],
}

type FetchSpy = ReturnType<typeof vi.fn<typeof fetch>>

function stub_send(): FetchSpy {
	const fetch_spy = vi
		.fn<typeof fetch>()
		.mockResolvedValue(new Response(undefined, { status: OK_STATUS, statusText: 'OK' }))

	vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token')
	vi.stubEnv('TELEGRAM_CHAT_ID', 'chat-id')
	vi.stubEnv('JOSH_NOTIFY', undefined)
	vi.stubEnv('JOSH_SESSION_LANG', 'en')
	vi.stubGlobal('fetch', fetch_spy)
	vi.spyOn(gh_spawn, 'get_repo_name_with_owner_within').mockReturnValue('owner/kit')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)

	return fetch_spy
}

// The request body is JSON, so the expected text is matched in its JSON-escaped form.
function escaped(text: string): string {
	return JSON.stringify(text).slice(1, -1)
}

function sent_body(fetch_spy: FetchSpy): string {
	const body = fetch_spy.mock.calls[0]?.[1]?.body

	return typeof body === 'string' ? body : ''
}

// joshuafolkken/kit#7889: every confirmation is recorded, whether or not it is sent.
describe('telegram_notify.confirm — the confirmation ledger', () => {
	it('records the reason and the Issue even when notifications are disabled', async () => {
		const fetch_spy = stub_send()
		const record = vi.spyOn(confirmation_ledger, 'record_sent').mockResolvedValue()

		vi.stubEnv('JOSH_NOTIFY', 'off')
		await telegram_notify.confirm({ ...CONFIRM, issue: ISSUE })

		expect(record).toHaveBeenCalledWith(
			expect.objectContaining({ task_type: 'confirmation', reason: CONFIRM.reason, issue: ISSUE }),
		)
		expect(fetch_spy).not.toHaveBeenCalled()
	})

	it('records the confirmation when the send fails', async () => {
		const fetch_spy = stub_send()
		const record = vi.spyOn(confirmation_ledger, 'record_sent').mockResolvedValue()

		fetch_spy.mockRejectedValue(new Error('gateway timeout'))
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await telegram_notify.confirm(CONFIRM)).toBe(false)
		expect(record).toHaveBeenCalledWith(expect.objectContaining({ reason: CONFIRM.reason }))
	})
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

// joshuafolkken/kit#3861: the stops that call `confirm` directly name the choice in the message.
describe('telegram_notify.confirm — the choices reach the message', () => {
	it('sends the recommended choice and the alternatives after the body', async () => {
		const fetch_spy = stub_send()

		await telegram_notify.confirm({ ...CONFIRM, alternatives: [ALTERNATIVE] })

		const expected = `${BODY}\n\nRecommended: ${RECOMMENDED}\nAlternatives:\n- ${ALTERNATIVE}`

		expect(sent_body(fetch_spy)).toContain(escaped(expected))
	})
})
