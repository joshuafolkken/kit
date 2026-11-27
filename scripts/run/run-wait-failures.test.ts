import { describe, expect, it } from 'vitest'
import { run_wait_failures } from './run-wait-failures'

const FILE_A = 'scripts/a.test.ts'
const FILE_B = 'scripts/b.test.ts'
const PASSED = ' ✓ |pure| scripts/ok.test.ts (3 tests) 4ms'
const FAILED_HEADER = ` ❯ |isolated| ${FILE_A} (2 tests | 1 failed) 4ms`
const DESCRIBE = '   ❯ d (2)'
const FAILED_TEST = '     × names every module a worker setup file imports 2ms'
const FAIL_SUMMARY = ` FAIL  |pure| ${FILE_B} > d > bad`

function log_of(...lines: ReadonlyArray<string>): string {
	return lines.join('\n')
}

describe('run_wait_failures.failed_files', () => {
	it('reads no failure in a log of passing files', () => {
		expect(run_wait_failures.failed_files(log_of(PASSED, ' Test Files  1 passed (1)'))).toEqual([])
	})

	it('names the file a × line sits under', () => {
		const log = log_of(' ✓ scripts/c.test.ts (2 tests) 4ms', DESCRIBE, FAILED_TEST)

		expect(run_wait_failures.failed_files(log)).toEqual(['scripts/c.test.ts'])
	})

	it('reads a × line before any file line as a failure of an unnamed file', () => {
		expect(run_wait_failures.failed_files(FAILED_TEST)).toEqual([run_wait_failures.UNNAMED_FILE])
	})

	it('reads a file that failed to collect, with its (0 test), as failed', () => {
		const log = log_of(
			' ✓ |pure| scripts/empty.test.ts (0 test)',
			' ❯ |isolated| scripts/broken.test.ts (0 test)',
		)

		expect(run_wait_failures.failed_files(log)).toEqual(['scripts/broken.test.ts'])
	})

	it('reads a FAIL summary line alone', () => {
		expect(run_wait_failures.failed_files(FAIL_SUMMARY)).toEqual([FILE_B])
	})

	it('names several files once each, in the order the log first names them', () => {
		const log = log_of(PASSED, FAILED_HEADER, DESCRIBE, FAILED_TEST, FAILED_TEST, FAIL_SUMMARY)
		const repeated = log_of(log, ` FAIL  |isolated| ${FILE_A} > d > bad`)

		expect(run_wait_failures.failed_files(repeated)).toEqual([FILE_A, FILE_B])
	})
})

describe('run_wait_failures.summary_of', () => {
	it('answers nothing for a log with no failure, or no log text', () => {
		expect(run_wait_failures.summary_of(PASSED)).toBeUndefined()
		expect(run_wait_failures.summary_of('')).toBeUndefined()
	})

	it('counts and names the failed files on one line', () => {
		const summary = run_wait_failures.summary_of(log_of(FAILED_HEADER, FAIL_SUMMARY))

		expect(summary).toBe(
			`failed so far: 2 test file(s) — ${FILE_A}, ${FILE_B} (stop and fix them, or wait for the full run)`,
		)
	})

	it('names the first files and counts the rest past the shown limit', () => {
		const count = run_wait_failures.NAMES_SHOWN + 2
		const lines = Array.from(
			{ length: count },
			(_, index) => ` FAIL  f${String(index)}.test.ts > t`,
		)
		const summary = run_wait_failures.summary_of(log_of(...lines)) ?? ''

		expect(summary).toContain(`failed so far: ${String(count)} test file(s)`)
		expect(summary).toContain('f0.test.ts')
		expect(summary).not.toContain(`f${String(count - 1)}.test.ts`)
		expect(summary).toContain(', and 2 more')
	})
})
