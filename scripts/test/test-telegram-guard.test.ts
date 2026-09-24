import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { telegram_notify } from '#scripts/git/telegram-notify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { test_network_guard } from './test-network-guard'
import { test_telegram_guard } from './test-telegram-guard'
import { GUARD_LOG_KEY } from './unit-guard-environment'

// joshuafolkken/kit#2494: a test that forgot to mock the notifier sent two real "backlogrun stopped"
// confirmations and passed. These cases send for real — no `fetch` stub — and point the guard's record
// at a scratch log, so the refusal is observed without failing the run this test is part of.

const TEMP_PREFIX = 'josh-telegram-guard-'
const LOG_NAME = 'network-calls.log'
const FAKE_TOKEN = 'unit-test-token'
const FAKE_CHAT = 'unit-test-chat'
const TELEGRAM_URL = `https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`
const OTHER_URL = 'https://example.invalid/'
const STOP_BODY = 'backlog drained'

const directories: Array<string> = []

afterEach(() => {
	vi.unstubAllEnvs()
	for (const directory of directories) rmSync(directory, { recursive: true, force: true })
	directories.length = 0
})

// A scratch record the guard writes to instead of the run's own.
function scratch_log(): string {
	const directory = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX))
	const log_file = path.join(directory, LOG_NAME)

	directories.push(directory)
	writeFileSync(log_file, '')
	vi.stubEnv(GUARD_LOG_KEY, log_file)

	return log_file
}

async function send_stop_notification(): Promise<void> {
	await telegram_notify.send({
		task_type: 'confirmation',
		repo_name: undefined,
		issue_title: undefined,
		body: STOP_BODY,
		issue_url: undefined,
		pr_url: undefined,
	})
}

describe('test_telegram_guard — an unmocked send', () => {
	it('is refused and recorded under the test that made it', async () => {
		const log_file = scratch_log()

		vi.stubEnv('TELEGRAM_BOT_TOKEN', FAKE_TOKEN)
		vi.stubEnv('TELEGRAM_CHAT_ID', FAKE_CHAT)

		await expect(send_stop_notification()).rejects.toThrow()

		const calls = test_network_guard.calls_of(readFileSync(log_file, 'utf8'))

		expect(calls).toHaveLength(1)
		expect(calls[0]).toContain(expect.getState().currentTestName ?? '')
		expect(calls[0]).not.toContain(FAKE_TOKEN)
		expect(test_network_guard.describe_violations(calls)).toContain(
			test_network_guard.VIOLATION_HEADING,
		)
	})

	it('is refused by the fetch the worker runs behind', async () => {
		scratch_log()

		await expect(fetch(TELEGRAM_URL)).rejects.toThrow(test_telegram_guard.BLOCKED_MESSAGE)
	})
})

describe('test_telegram_guard.is_telegram — what counts as a send', () => {
	it('matches the Telegram API host in every request shape', () => {
		expect(test_telegram_guard.is_telegram(TELEGRAM_URL)).toBe(true)
		expect(test_telegram_guard.is_telegram(new URL(TELEGRAM_URL))).toBe(true)
		expect(test_telegram_guard.is_telegram(new Request(TELEGRAM_URL))).toBe(true)
	})

	it('leaves every other host alone', () => {
		expect(test_telegram_guard.is_telegram(OTHER_URL)).toBe(false)
		expect(test_telegram_guard.is_telegram('not a url')).toBe(false)
	})
})

describe('test_telegram_guard.guarded_fetch — the calls it passes through', () => {
	it('hands a non-Telegram request to the real fetch untouched', async () => {
		const response = new Response('ok')
		const real_fetch = vi.fn<typeof fetch>().mockResolvedValue(response)

		await expect(test_telegram_guard.guarded_fetch(real_fetch)(OTHER_URL)).resolves.toBe(response)
		expect(real_fetch).toHaveBeenCalledWith(OTHER_URL, undefined)
	})
})
