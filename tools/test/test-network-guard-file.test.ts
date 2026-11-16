import { readFileSync } from 'node:fs'
import path from 'node:path'
import { vitest_failure_summary } from '#scripts/test/vitest-failure-summary'
import { temporary_directory } from '#tools/test/temporary-directory'
import { test_network_guard } from '#tools/test/test-network-guard'
import { test_repository_guard } from '#tools/test/test-repository-guard'
import { TEST_FILE_KEY, TEST_FILE_SEPARATOR } from '#tools/test/unit-guard-environment'
import { execaSync } from 'execa'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#7638: a violation that named only the command sent a lane through thirteen
// `test:related` runs to find the file that made it. The record now carries the calling test file,
// and the failure groups each file's calls under vitest's own `FAIL` mark.

const TEMP_PREFIX = 'josh-network-guard-file-'
const CALLER = path.join('scripts', 'run', 'merge', 'run-merge-observation.test.ts')
const OTHER_CALLER = path.join('scripts', 'other.test.ts')
const VERSION_CALL = 'gh --version'
const API_CALL = 'gh api one'
const ADD_ARGUMENTS = ['add', '.']

const make_directory = temporary_directory()

function from(file: string, command: string): string {
	return `${command}${TEST_FILE_SEPARATOR}${file}`
}

function failure_lines(calls: ReadonlyArray<string>): Array<string> {
	return test_network_guard.describe_violations(calls).split('\n')
}

// One spawn of a shim installed in a scratch directory, with the calling file in its environment,
// answering what the shim recorded.
function recorded_by(
	name: string,
	args: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
): string {
	const directory = make_directory(TEMP_PREFIX)

	test_network_guard.install_shim_guarding(directory, undefined)
	execaSync(path.join(directory, name), args, { env: environment, reject: false })

	return readFileSync(test_network_guard.log_in(directory), 'utf8')
}

describe('test_network_guard — the record names the calling test file', () => {
	it('ends a blocked gh call with the test file the worker named', () => {
		const log = recorded_by(test_network_guard.SHIM_NAME, ['--version'], {
			[TEST_FILE_KEY]: CALLER,
		})

		expect(test_network_guard.calls_of(log)).toStrictEqual([from(CALLER, VERSION_CALL)])
	})

	// A call from outside any test file still records, with no file after it.
	it('records a call with no test file named as the command alone', () => {
		const log = recorded_by(test_network_guard.SHIM_NAME, ['--version'], { [TEST_FILE_KEY]: '' })

		expect(test_network_guard.calls_of(log)).toStrictEqual([VERSION_CALL])
	})

	it('ends a refused write with the test file too', () => {
		const environment = {
			[TEST_FILE_KEY]: CALLER,
			GIT_DIR: path.join(make_directory(TEMP_PREFIX), '.git'),
		}
		const [call = ''] = test_network_guard.calls_of(
			recorded_by(test_network_guard.GIT_SHIM_NAME, ADD_ARGUMENTS, environment),
		)

		expect(test_repository_guard.is_write_violation(call)).toBe(true)
		expect(call.endsWith(from(CALLER, ''))).toBe(true)
	})
})

describe('test_network_guard.describe_violations — grouped by test file', () => {
	it('names the test file above the calls it made', () => {
		const calls = [
			from(CALLER, VERSION_CALL),
			from(OTHER_CALLER, API_CALL),
			from(CALLER, VERSION_CALL),
		]

		expect(failure_lines(calls)).toStrictEqual([
			test_network_guard.VIOLATION_HEADING,
			` FAIL  ${CALLER}`,
			`  2x  ${VERSION_CALL}`,
			` FAIL  ${OTHER_CALLER}`,
			`  1x  ${API_CALL}`,
		])
	})

	it('lists a call with no test file the way it always did, ahead of the named ones', () => {
		expect(failure_lines([from(CALLER, VERSION_CALL), API_CALL])).toStrictEqual([
			test_network_guard.VIOLATION_HEADING,
			`  1x  ${API_CALL}`,
			` FAIL  ${CALLER}`,
			`  1x  ${VERSION_CALL}`,
		])
	})

	it('keeps a write violation under its own heading, with its file', () => {
		const write = from(CALLER, `${test_repository_guard.WRITE_MARKER} git add .`)

		expect(failure_lines([write]).slice(0, 2)).toStrictEqual([
			test_repository_guard.WRITE_VIOLATION_HEADING,
			` FAIL  ${CALLER}`,
		])
	})
})

// The run summary collects failed files from vitest's `FAIL` lines, so the guard's failure must name
// the file there rather than leave `failed tests: (none named …)`.
describe('test_network_guard.describe_violations — read by the test run summary', () => {
	it('hands the summary the file to mock in', () => {
		const output = `Error: ${test_network_guard.describe_violations([from(CALLER, VERSION_CALL)])}`

		expect(
			vitest_failure_summary.failed_files(vitest_failure_summary.failed_tests(output)),
		).toStrictEqual([CALLER])
	})
})

// Review round 1: the file is the line's tail, so a tab inside the command must not move it.
describe('test_network_guard.describe_violations — a command holding the separator', () => {
	it('takes the file from the end of the line', () => {
		const command = `gh api one${TEST_FILE_SEPARATOR}two`

		expect(failure_lines([from(CALLER, command)]).slice(1)).toStrictEqual([
			` FAIL  ${CALLER}`,
			`  1x  ${command}`,
		])
	})
})
