import { afterEach, describe, expect, it, vi } from 'vitest'
import { telegram_notify, type TelegramSendInput, type TelegramTaskType } from './telegram-notify'

const OPT_IN_KEY = 'JOSH_NOTIFY_OPT_IN'
const NOTIFY_SWITCH_KEY = 'JOSH_NOTIFY'
const OK_STATUS = 200

interface Spies {
	fetch_spy: ReturnType<typeof vi.fn>
	infos: Array<string>
}

function set_environment(opt_in: string | undefined, has_credentials: boolean): void {
	vi.stubEnv('TELEGRAM_BOT_TOKEN', has_credentials ? 'bot-token' : undefined)
	vi.stubEnv('TELEGRAM_CHAT_ID', has_credentials ? 'chat-id' : undefined)
	vi.stubEnv(NOTIFY_SWITCH_KEY, undefined)
	vi.stubEnv(OPT_IN_KEY, opt_in)
}

function stub_spies(): Spies {
	const fetch_spy = vi.fn().mockResolvedValue({ ok: true, status: OK_STATUS, statusText: 'OK' })
	const infos: Array<string> = []

	vi.stubGlobal('fetch', fetch_spy)
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		infos.push(line)
	})

	return { fetch_spy, infos }
}

function input_of(task_type: TelegramTaskType): TelegramSendInput {
	return {
		task_type,
		repo_name: 'kit',
		issue_title: 'A title',
		body: undefined,
		issue_url: undefined,
		pr_url: undefined,
	}
}

async function send_each(task_types: ReadonlyArray<TelegramTaskType>): Promise<void> {
	await Promise.all(
		task_types.map(async (task_type) => {
			await telegram_notify.send(input_of(task_type))
		}),
	)
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

// joshuafolkken/kit#3861. `planning` and `completion` need nobody to act, so they are sent only once
// opted in; every other type is sent as before.
describe('telegram_notify.send — JOSH_NOTIFY_OPT_IN gates the optional types', () => {
	it.each(['planning', 'completion'] as const)(
		'skips %s without credentials when unset',
		async (task_type) => {
			set_environment(undefined, false)
			const { fetch_spy, infos } = stub_spies()

			await expect(telegram_notify.send(input_of(task_type))).resolves.toBeUndefined()
			expect(infos.join('\n')).toContain(`${task_type} notifications are not opted in`)
			expect(fetch_spy).not.toHaveBeenCalled()
		},
	)

	it('sends only the type that is named, whatever its case and spacing', async () => {
		set_environment(' Planning ', true)
		const { fetch_spy } = stub_spies()

		await send_each(['planning', 'completion'])

		expect(fetch_spy).toHaveBeenCalledTimes(1)
	})

	it('sends both when both are named', async () => {
		set_environment('planning, completion', true)
		const { fetch_spy } = stub_spies()

		await send_each(['planning', 'completion'])

		expect(fetch_spy).toHaveBeenCalledTimes(2)
	})

	it('leaves every other type on when unset', async () => {
		set_environment(undefined, true)
		const { fetch_spy } = stub_spies()

		await send_each(['confirmation', 'failure', 'warning'])

		expect(fetch_spy).toHaveBeenCalledTimes(3)
	})
})

describe('telegram_notify.send — JOSH_NOTIFY=off outranks JOSH_NOTIFY_OPT_IN', () => {
	it('lets JOSH_NOTIFY=off win over an opt-in', async () => {
		set_environment('planning', false)
		vi.stubEnv(NOTIFY_SWITCH_KEY, 'off')
		const { fetch_spy, infos } = stub_spies()

		await telegram_notify.send(input_of('planning'))

		expect(infos.join('\n')).toContain('disabled')
		expect(fetch_spy).not.toHaveBeenCalled()
	})
})
