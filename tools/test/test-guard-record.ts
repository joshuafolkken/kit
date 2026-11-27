import { appendFileSync } from 'node:fs'
import { expect } from 'vitest'
import { GUARD_LOG_KEY } from './unit-guard-environment'

// How an in-process worker guard (Telegram, sound) records an attempt: one `<name> <test>` line in
// the network guard's log, which `disarm` reads at teardown and fails the run with. No command line
// to quote, so the line names the test that made the call.

const UNKNOWN_TEST = '(outside a test)'

function current_test(): string {
	const state = expect.getState()

	return [state.testPath, state.currentTestName ?? UNKNOWN_TEST].filter(Boolean).join(' > ')
}

// `>>`-style append, for `shim_shell.record_line`'s reason: every worker writes the one record.
function record(name: string): void {
	const log_file = process.env[GUARD_LOG_KEY]

	if (log_file !== undefined) appendFileSync(log_file, `${name} ${current_test()}\n`)
}

const test_guard_record = { current_test, record }

export { test_guard_record }
