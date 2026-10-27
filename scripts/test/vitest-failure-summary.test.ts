import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gate_log } from '#scripts/gate/gate-log'
import { gate_test_fixture } from '#scripts/gate/gate-test-fixture'
import { status_icons } from '#scripts/lib/status-icons'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { vitest_failure_summary } from './vitest-failure-summary'

const { FAIL_ICON, PASS_ICON } = status_icons

// joshuafolkken/kit#4869: a failed `josh test:related` piped through `tail` kept the last stack and
// no names, and the names cost a second run of the suite.

const FIRST = 'scripts/a.test.ts > suite > fails first'
const SECOND = 'scripts/b.test.ts [ scripts/b.test.ts ]'
const RELATED: ReadonlyArray<string> = ['related', 'scripts/a.ts', '--run']
const LOG_PATH = path.join('logs', 'josh-unit-log-x.log')
const FAILED_OUTPUT = [
	' RUN  v4.0.0 /repo',
	' ❯ scripts/a.test.ts (2 tests | 1 failed)',
	'   × fails first',
	'⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯',
	'',
	` FAIL  ${FIRST}`,
	'AssertionError: expected 1 to be 2',
	` \u{1B}[31mFAIL\u{1B}[39m  ${SECOND}`,
	` FAIL  ${FIRST}`,
	' Test Files  2 failed (2)',
].join('\n')

const ctx = { directory: '' }

beforeEach(() => {
	ctx.directory = mkdtempSync(path.join(tmpdir(), 'vitest-failure-summary-'))
})

afterEach(() => {
	rmSync(ctx.directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

const { capture_stdout } = gate_test_fixture

describe('vitest_failure_summary.failed_tests', () => {
	it('lists each FAIL line once, colors stripped, in order', () => {
		expect(vitest_failure_summary.failed_tests(FAILED_OUTPUT)).toStrictEqual([FIRST, SECOND])
	})

	it('lists nothing for output without a FAIL line', () => {
		expect(vitest_failure_summary.failed_tests(' Test Files  1 passed (1)')).toStrictEqual([])
	})
})

describe('vitest_failure_summary.format_failure_summary', () => {
	it('ends with the failed names and then the full-output path', () => {
		const lines = vitest_failure_summary.format_failure_summary(FAILED_OUTPUT, LOG_PATH).split('\n')

		expect(lines).toStrictEqual([
			'failed tests:',
			`  ${FIRST}`,
			`  ${SECOND}`,
			`${vitest_failure_summary.RERUN_PREFIX}scripts/a.test.ts scripts/b.test.ts`,
			`${gate_log.LOG_NOTICE_PREFIX}${LOG_PATH}`,
			`${FAIL_ICON} vitest failed: scripts/a.test.ts, scripts/b.test.ts`,
			'',
		])
	})

	it('says no name was found and prints no rerun command', () => {
		const summary = vitest_failure_summary.format_failure_summary('crashed', undefined)

		expect(summary).toContain('none named in the output')
		expect(summary).not.toContain(vitest_failure_summary.RERUN_PREFIX)
		expect(
			summary.endsWith(`${gate_log.LOG_FAILED_NOTICE}\n${FAIL_ICON} vitest failed: none named\n`),
		).toBe(true)
	})
})

// joshuafolkken/kit#5023: a lane that fixed one failed file reran the whole related set to confirm it.
describe('vitest_failure_summary.failed_files', () => {
	it('names each failed file once, whether a test or a load failed', () => {
		expect(vitest_failure_summary.failed_files([FIRST, SECOND, FIRST])).toStrictEqual([
			'scripts/a.test.ts',
			'scripts/b.test.ts',
		])
	})

	it('drops the workspace project label', () => {
		const labelled = '|isolated| scripts/c.test.ts > suite > reads the env'

		expect(vitest_failure_summary.failed_files([labelled])).toStrictEqual(['scripts/c.test.ts'])
	})

	// joshuafolkken/kit#5171: a colored run prints the label as a badge, which stripping leaves bare.
	it('drops the project badge a colored run prints', () => {
		const output = ' FAIL  \u{1B}[46m isolated \u{1B}[49m tools/d.test.ts > suite > lists'
		const names = vitest_failure_summary.failed_tests(output)

		expect(vitest_failure_summary.failed_files(names)).toStrictEqual(['tools/d.test.ts'])
	})
})

describe('vitest_failure_summary.report', () => {
	it('writes the whole output to the log and prints the summary last on a failure', () => {
		const target = path.join(ctx.directory, 'unit.log')
		const captured = capture_stdout()

		vitest_failure_summary.report(RELATED, FAILED_OUTPUT, 1, target)

		expect(readFileSync(target, 'utf8')).toContain(`=== vitest ${RELATED.join(' ')} ===`)
		expect(readFileSync(target, 'utf8')).toContain(FAILED_OUTPUT)
		expect(captured.text()).toBe(
			vitest_failure_summary.format_failure_summary(FAILED_OUTPUT, target, 'vitest related'),
		)
	})

	// joshuafolkken/kit#5162: a green run's last line was vitest's counts, so a run piped it into `tail`.
	it('writes the log and ends a pass with the log path and its verdict', () => {
		const target = path.join(ctx.directory, 'unit.log')
		const captured = capture_stdout()

		vitest_failure_summary.report(RELATED, 'all green', 0, target)

		expect(readFileSync(target, 'utf8')).toContain('all green')
		expect(captured.text()).toBe(
			`${gate_log.LOG_NOTICE_PREFIX}${target}\n${PASS_ICON} vitest related passed\n`,
		)
	})

	it('keeps the log beside the gate log in the temp directory', () => {
		const log_path = vitest_failure_summary.unit_log_path(RELATED)

		expect(path.dirname(log_path)).toBe(path.dirname(gate_log.gate_log_path()))
		expect(path.basename(log_path)).toMatch(/^josh-unit-log-related-.+\.log$/u)
	})

	// The gate's whole-suite run and a `related` run beside it overlap; one file would hand the
	// failed run's reader the other's output.
	it('gives a whole-suite run and a related run separate logs', () => {
		expect(vitest_failure_summary.unit_log_path(['run'])).not.toBe(
			vitest_failure_summary.unit_log_path(RELATED),
		)
	})
})
