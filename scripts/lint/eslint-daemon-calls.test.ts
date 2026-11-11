import { readFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { write_file } from '#tools/test/write-file'
import { describe, expect, it } from 'vitest'
import { eslint_daemon_calls } from './eslint-daemon-calls'

// joshuafolkken/kit#7245: the daemon's footprint follows the files it linted over its life, so each
// call is recorded with its caller and the running total of the daemon it reached.

const { CALLS_RECORD, DAEMON_CALLER } = eslint_daemon_calls
const DAEMON = 'token 4321 77 hash'
const OTHER_DAEMON = 'token 4321 88 hash'
const NOW = new Date('2026-11-11T00:00:00.000Z')
const PREFIX = 'eslint-daemon-calls-'
const make_directory = temporary_directory()

function read_calls(directory: string): string {
	return readFileSync(path.join(directory, CALLS_RECORD), 'utf8')
}

describe('eslint_daemon_calls.record', () => {
	it('adds each call of one daemon to its running total', () => {
		const directory = make_directory(PREFIX)

		eslint_daemon_calls.record(directory, DAEMON, { caller: DAEMON_CALLER.WARM, files: 1 }, NOW)
		eslint_daemon_calls.record(
			directory,
			DAEMON,
			{ caller: DAEMON_CALLER.PRE_COMMIT, files: 12 },
			NOW,
		)

		expect(read_calls(directory)).toBe(
			'2026-11-11T00:00:00.000Z caller=warm files=1 total=1 pid=77\n' +
				'2026-11-11T00:00:00.000Z caller=pre-commit files=12 total=13 pid=77\n',
		)
	})

	it('starts the record afresh for a daemon it has not seen', () => {
		const directory = make_directory(PREFIX)

		write_file(directory, CALLS_RECORD, 'old caller=warm files=1 total=40 pid=77\n')

		eslint_daemon_calls.record(
			directory,
			OTHER_DAEMON,
			{ caller: DAEMON_CALLER.LINT_RELATED, files: 3 },
			NOW,
		)

		expect(read_calls(directory)).toBe(
			'2026-11-11T00:00:00.000Z caller=lint:related files=3 total=3 pid=88\n',
		)
	})

	it('writes nothing when no daemon is running', () => {
		const directory = make_directory(PREFIX)

		eslint_daemon_calls.record(directory, undefined, { caller: DAEMON_CALLER.EDIT_HOOK, files: 1 })

		expect(() => read_calls(directory)).toThrow()
	})
})
