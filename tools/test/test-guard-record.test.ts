import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { test_guard_record } from '#tools/test/test-guard-record'
import { GUARD_LOG_KEY } from '#tools/test/unit-guard-environment'
import { afterEach, describe, expect, it, vi } from 'vitest'

const TEMP_PREFIX = 'josh-guard-record-'
const LOG_NAME = 'network-calls.log'
const RECORD_NAME = 'probe'

const make_directory = temporary_directory()

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('test_guard_record', () => {
	it('names the running test file and test', () => {
		expect(test_guard_record.current_test()).toMatch(
			/test-guard-record\.test\.ts > test_guard_record > names the running test file and test$/u,
		)
	})

	it('appends one named line to the guard log', () => {
		const log_file = path.join(make_directory(TEMP_PREFIX), LOG_NAME)

		writeFileSync(log_file, '')
		vi.stubEnv(GUARD_LOG_KEY, log_file)
		test_guard_record.record(RECORD_NAME)

		expect(readFileSync(log_file, 'utf8')).toBe(
			`${RECORD_NAME} ${test_guard_record.current_test()}\n`,
		)
	})

	it('writes nothing when no guard log is armed', () => {
		vi.stubEnv(GUARD_LOG_KEY, undefined)

		expect(() => {
			test_guard_record.record(RECORD_NAME)
		}).not.toThrow()
	})
})
