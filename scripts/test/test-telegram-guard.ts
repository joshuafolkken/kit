import { appendFileSync } from 'node:fs'
import { expect } from 'vitest'
import { GUARD_LOG_KEY } from './unit-guard-environment'

// **A unit test that forgets to mock a notification must fail rather than notify**
// (joshuafolkken/kit#2494). A lane child's new test drove `run_carry_cli.run(['--end', '--stopped',
// …])` without replacing `./run-stop-notify`, and two runs of it sent two real "backlogrun stopped"
// confirmations — while the run was still going — and the test passed. `telegram-notify.ts` posts
// with Node's own `fetch`, which the `gh` / `git` `PATH` shims in `test-network-guard.ts` never see.
//
// **This wraps `fetch` in every worker rather than mocking the notifier module**, for the reason the
// network guard shims a binary rather than mocking a module: any caller that reaches Telegram is
// caught, not only the import graph a mock was written against. Anything not addressed to Telegram
// is handed to the real `fetch` untouched, and a test that stubs `fetch` itself replaces this
// wrapper for its own duration, so the correctly mocked suites (`telegram-notify.test.ts`) see
// nothing of it.
//
// **The attempt is recorded in the network guard's own log, not a second one.** `disarm` already
// reads that record at teardown and throws with every line in it, so a Telegram send fails the run
// and is reported exactly as a live `gh api` is — naming the test that made it, since a `fetch` has
// no command line to quote. The call itself is refused either way, so even an unarmed run sends
// nothing.
//
// **Only this process is covered.** A CLI a test spawns as a subprocess loads no setup file; the
// unit suite's Telegram sends so far have all been in-process, and the subprocess case is left to
// the notifier's own mocks.

const TELEGRAM_HOST = 'api.telegram.org'
const RECORD_NAME = 'telegram'
const BLOCKED_MESSAGE =
	'josh: the unit suite must not send a Telegram notification — mock it instead'
const UNKNOWN_TEST = '(outside a test)'
// Marks a `fetch` that is already this wrapper. `isolate: false` re-runs a setup file for every test
// file in one worker, and wrapping the wrapper each time would stack one closure per file.
const GUARDED_MARK = Symbol.for('josh.unit-telegram-guard')

type Fetch = typeof globalThis.fetch
type GuardedFetch = Fetch & { [GUARDED_MARK]?: true }

function request_url(input: Parameters<Fetch>[0]): string {
	if (typeof input === 'string') return input

	return input instanceof URL ? input.href : input.url
}

// The host, compared exactly. The URL carries the bot token in its path, so nothing of it is kept.
function is_telegram(input: Parameters<Fetch>[0]): boolean {
	return URL.parse(request_url(input))?.hostname === TELEGRAM_HOST
}

function current_test(): string {
	const state = expect.getState()

	return [state.testPath, state.currentTestName ?? UNKNOWN_TEST].filter(Boolean).join(' > ')
}

// `>>`-style append, for `shim_shell.record_line`'s reason: every worker writes the one record.
function record(log_file: string | undefined): void {
	if (log_file !== undefined) appendFileSync(log_file, `${RECORD_NAME} ${current_test()}\n`)
}

function guarded_fetch(real_fetch: Fetch): GuardedFetch {
	const guarded: GuardedFetch = async function (input, init) {
		if (!is_telegram(input)) return await real_fetch(input, init)

		record(process.env[GUARD_LOG_KEY])

		throw new Error(BLOCKED_MESSAGE)
	}

	guarded[GUARDED_MARK] = true

	return guarded
}

// A plain assignment rather than `vi.stubGlobal`: a test's own `vi.unstubAllGlobals` restores what
// was there before the *first* stub, which would be the unguarded `fetch` had this been one.
function install(): void {
	const current: GuardedFetch = fetch

	if (current[GUARDED_MARK] !== true) Reflect.set(globalThis, 'fetch', guarded_fetch(current))
}

// The wrapping is the setup file's whole purpose, so its top-level effect is deliberate.
// eslint-disable-next-line unicorn/no-top-level-side-effects
install()

const test_telegram_guard = { BLOCKED_MESSAGE, RECORD_NAME, guarded_fetch, is_telegram }

export { test_telegram_guard }
