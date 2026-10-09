import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	build_text,
	telegram_environment_schema,
	telegram_notify,
	type TelegramSendInput,
} from './telegram-notify'

const ISSUE_URL = 'https://github.com/owner/repo/issues/1'
const BOT_TOKEN = 'bot-token-123'
const CHAT_ID = 'chat-456'
const PR_URL = 'https://github.com/owner/repo/pull/2'
const REPO_NAME = 'joshuafolkken-com'
const ISSUE_TITLE = 'Fix something important'
const BODY = '- Added foo\n- Changed bar'

const BOT_TOKEN_KEY = 'TELEGRAM_BOT_TOKEN'
const CHAT_ID_KEY = 'TELEGRAM_CHAT_ID'
const NOTIFY_SWITCH_KEY = 'JOSH_NOTIFY'
const GATEWAY_TIMEOUT_STATUS = 504
const REDACTION_MARKER = '<redacted>'
const RECOVERY_HINT = 'send it by hand with `pnpm josh notify`'
const DNS_FAILURE_TEXT = 'getaddrinfo ENOTFOUND api.telegram.org'
const GATEWAY_TIMEOUT_TEXT = 'Gateway Time-out'
const OK_STATUS = 200

// A developer's own shell may carry these, so every case states exactly what it means to test.
// `vi.stubEnv` removes the variable when handed `undefined`, and `vi.unstubAllEnvs` puts the
// environment back whatever it held.
//
// The opt-out switch is cleared here too, so a shell that disabled notifications cannot turn every
// failure case below into a skip.
function set_credentials(bot_token: string | undefined, chat_id: string | undefined): void {
	vi.stubEnv(BOT_TOKEN_KEY, bot_token)
	vi.stubEnv(CHAT_ID_KEY, chat_id)
	vi.stubEnv(NOTIFY_SWITCH_KEY, undefined)
}

function stub_fetch(response: { ok: boolean; status: number; statusText: string }): void {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
}

function stub_failing_fetch(error: Error): void {
	vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
}

function silence_console(): { errors: Array<string> } {
	const errors: Array<string> = []

	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation((...parts: Array<unknown>) => {
		errors.push(parts.map(String).join(' '))
	})

	return { errors }
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

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

// joshuafolkken/kit#1628. A run that merged and lost its time-history record is neither a failure
// nor a plain completion, and labelling it either way is the whole problem: ❌ says the merge broke,
// a second ✅ says nothing went wrong.
describe('build_text — warning header', () => {
	it('uses ⚠️ + the completed-with-a-warning label', () => {
		const result = build_text(make_base({ task_type: 'warning' }))

		expect(result).toBe(`⚠️ ${REPO_NAME}: Completed with a warning\n${ISSUE_TITLE}`)
	})
})

describe('build_text — confirmation header', () => {
	it('uses ⏸️ + Confirmation required label', () => {
		const result = build_text(make_base({ task_type: 'confirmation' }))

		expect(result).toBe(`⏸️ ${REPO_NAME}: Confirmation required\n${ISSUE_TITLE}`)
	})
})

describe('build_text — stranded header', () => {
	it('uses 🚨 + the nobody-is-driving label', () => {
		const result = build_text(make_base({ task_type: 'stranded' }))

		expect(result).toBe(`🚨 ${REPO_NAME}: Run stranded — nobody is driving it\n${ISSUE_TITLE}`)
	})
})

// joshuafolkken/kit#3569: a periodic board frame reads apart from a confirmation or a completion.
describe('build_text — progress header', () => {
	it('uses the progress icon and label', () => {
		const result = build_text(make_base({ task_type: 'progress' }))

		expect(result).toBe(`📊 ${REPO_NAME}: Progress\n${ISSUE_TITLE}`)
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

// joshuafolkken/kit#1564. Both of these paths used to warn and return, so a notification that
// reached nobody exited 0 and was indistinguishable from one that arrived.
describe('telegram_notify.send — a notification that reached nobody', () => {
	it('throws naming the missing variable, never its value', async () => {
		set_credentials(undefined, CHAT_ID)
		silence_console()

		await expect(telegram_notify.send(make_base({}))).rejects.toThrow(BOT_TOKEN_KEY)
		await expect(telegram_notify.send(make_base({}))).rejects.not.toThrow(CHAT_ID)
	})

	it('throws carrying the status code when the request is refused', async () => {
		set_credentials(BOT_TOKEN, CHAT_ID)
		stub_fetch({ ok: false, status: GATEWAY_TIMEOUT_STATUS, statusText: GATEWAY_TIMEOUT_TEXT })
		silence_console()

		await expect(telegram_notify.send(make_base({}))).rejects.toThrow(
			String(GATEWAY_TIMEOUT_STATUS),
		)
	})

	// The request URL carries the bot token in its path, so an error formatted anywhere near the
	// request can carry it out of the module. Nothing downstream redacts, so this does.
	it('redacts the credentials out of an error that carried them', async () => {
		set_credentials(BOT_TOKEN, CHAT_ID)
		stub_failing_fetch(new Error(`fetch failed for /bot${BOT_TOKEN}/sendMessage to ${CHAT_ID}`))
		silence_console()

		await expect(telegram_notify.send(make_base({}))).rejects.toThrow(REDACTION_MARKER)
		await expect(telegram_notify.send(make_base({}))).rejects.not.toThrow(BOT_TOKEN)
		await expect(telegram_notify.send(make_base({}))).rejects.not.toThrow(CHAT_ID)
	})
})

// joshuafolkken/kit#2981: the send is awaited by unattended runs, so a stalled connection must time
// out rather than hold the run forever.
describe('telegram_notify.send — the request carries a time limit', () => {
	it('sends with an abort signal attached', async () => {
		set_credentials(BOT_TOKEN, CHAT_ID)
		const fetch_spy = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))

		vi.stubGlobal('fetch', fetch_spy)
		silence_console()
		await telegram_notify.send(make_base({}))
		const [call] = fetch_spy.mock.calls

		expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal)
	})
})

// joshuafolkken/kit#2821. A consumer who chose not to use Telegram states it once, and only that
// stated choice skips the send — a forgotten setup still fails as #1564 requires.
describe('telegram_notify.send — JOSH_NOTIFY=off opts out explicitly', () => {
	it('skips without credentials, says notifications are disabled, and never fetches', async () => {
		set_credentials(undefined, undefined)
		vi.stubEnv(NOTIFY_SWITCH_KEY, ' OFF ')
		const fetch_spy = vi.fn()

		vi.stubGlobal('fetch', fetch_spy)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await expect(telegram_notify.send(make_base({}))).resolves.toBeUndefined()
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('disabled'))
		expect(fetch_spy).not.toHaveBeenCalled()
	})

	it('answers true from the tolerant form and reports nothing', async () => {
		set_credentials(undefined, undefined)
		vi.stubEnv(NOTIFY_SWITCH_KEY, 'off')
		const { errors } = silence_console()

		await expect(telegram_notify.send_or_report(make_base({}), RECOVERY_HINT)).resolves.toBe(true)
		expect(errors).toHaveLength(0)
	})

	it('still fails on missing credentials when the switch is unset', async () => {
		set_credentials(undefined, undefined)
		silence_console()

		await expect(telegram_notify.send(make_base({}))).rejects.toThrow(BOT_TOKEN_KEY)
	})

	it('still fails on missing credentials when the switch holds any other value', async () => {
		set_credentials(undefined, undefined)
		vi.stubEnv(NOTIFY_SWITCH_KEY, 'no')
		silence_console()

		await expect(telegram_notify.send(make_base({}))).rejects.toThrow(BOT_TOKEN_KEY)
	})
})

// The other half of the same Issue: inside `followup` the send happens on the way to the merge, so a
// gateway timeout must not leave a reviewed, green pull request unmerged.
describe('telegram_notify.send_or_report — reports and carries on', () => {
	it("answers false and reports the caller's recovery instead of throwing", async () => {
		set_credentials(BOT_TOKEN, CHAT_ID)
		stub_fetch({ ok: false, status: GATEWAY_TIMEOUT_STATUS, statusText: GATEWAY_TIMEOUT_TEXT })
		const { errors } = silence_console()

		await expect(telegram_notify.send_or_report(make_base({}), RECOVERY_HINT)).resolves.toBe(false)
		expect(errors.join('\n')).toContain(RECOVERY_HINT)
		expect(errors.join('\n')).not.toContain(BOT_TOKEN)
	})

	// A caller with no command that finishes the job says so, rather than being given one that would
	// not work — the completion notification `followup` sends is exactly that case.
	it('prints no recovery line when the caller has none', async () => {
		set_credentials(BOT_TOKEN, CHAT_ID)
		stub_fetch({ ok: false, status: GATEWAY_TIMEOUT_STATUS, statusText: GATEWAY_TIMEOUT_TEXT })
		const { errors } = silence_console()

		await expect(telegram_notify.send_or_report(make_base({}), undefined)).resolves.toBe(false)
		expect(errors.join('\n')).toContain(String(GATEWAY_TIMEOUT_STATUS))
		expect(errors.join('\n')).not.toContain('Recovery')
	})

	// A `fetch` rejection's own message is the bare `fetch failed`; the diagnosis is one level down.
	it('reports the cause, not only the top-level message', async () => {
		set_credentials(BOT_TOKEN, CHAT_ID)
		stub_failing_fetch(new Error('fetch failed', { cause: new Error(DNS_FAILURE_TEXT) }))
		const { errors } = silence_console()

		await expect(telegram_notify.send_or_report(make_base({}), undefined)).resolves.toBe(false)

		// Once, not twice: the thrown error's own `cause` is a redacted copy of its message, so a
		// reporter that walked the chain again would print the whole reason a second time.
		const printed = errors.join('\n')

		expect(printed).toContain(DNS_FAILURE_TEXT)
		expect(printed.indexOf(DNS_FAILURE_TEXT)).toBe(printed.lastIndexOf(DNS_FAILURE_TEXT))
	})

	it('answers true when the send succeeds', async () => {
		set_credentials(BOT_TOKEN, CHAT_ID)
		stub_fetch({ ok: true, status: OK_STATUS, statusText: 'OK' })
		silence_console()

		await expect(telegram_notify.send_or_report(make_base({}), RECOVERY_HINT)).resolves.toBe(true)
	})
})
