import { readFileSync } from 'node:fs'
import path from 'node:path'
import { status_icons } from '#scripts/lib/status-icons'
import { lint_related_scope } from '#scripts/lint/lint-related-scope'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { check_related, type CheckResult } from './check-related'

const make_directory = temporary_directory('suite')
const scratch = make_directory('check-related-tail-test-')
const LOG_TARGET = path.join(scratch, 'check-related.log')
const [LINT_COMMAND, TEST_COMMAND] = check_related.CHECKS
const LINT_OUTPUT = 'lint output'
const LINT_PASSED = `${status_icons.PASS_ICON} ${lint_related_scope.COMMAND_LABEL} passed`
const FULL_OUTPUT_LINE = `full output: ${LOG_TARGET}`

function report_lines(results: ReadonlyArray<CheckResult>): Array<string> {
	const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

	check_related.report_results(results, { log_target: LOG_TARGET })

	return write.mock.calls
		.map(([chunk]) => String(chunk))
		.join('')
		.trimEnd()
		.split('\n')
}

function report_with_lint_output(lint_output: string): Array<string> {
	return report_lines(
		check_related.CHECKS.map((command): CheckResult => ({
			command,
			exit_code: 0,
			output: command === LINT_COMMAND ? lint_output : `${command} output`,
		})),
	)
}

afterEach(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#7823: lint:related no longer measures the metrics totals, so nothing is repeated.
describe('check_related.report_results green tail', () => {
	it('adds nothing above the log notice and the verdict line', () => {
		const lines = report_with_lint_output(`${LINT_OUTPUT}\n${LINT_PASSED}\n`)

		expect(lines.slice(-4)).toStrictEqual([
			`${check_related.CHECKS.at(-1) ?? ''} output`,
			'',
			FULL_OUTPUT_LINE,
			`${status_icons.PASS_ICON} check:related passed`,
		])
	})
})

// joshuafolkken/kit#5162: failures, then where the whole output went, then the verdict.
describe('check_related.report_results tail', () => {
	const results = check_related.CHECKS.map((command): CheckResult => ({
		command,
		exit_code: command === TEST_COMMAND ? 1 : 0,
		output: `${command} output`,
	}))

	it('keeps every check section in the log file', () => {
		report_lines(results)

		expect(readFileSync(LOG_TARGET, 'utf8')).toContain('=== test:related: failed (1) ===')
	})

	it('ends with the failed check, its re-run command, the log notice and the verdict', () => {
		expect(report_lines(results).slice(-4)).toStrictEqual([
			'check:related — next:',
			`  ${status_icons.FAIL_ICON} test:related — re-run: pnpm josh test:related`,
			FULL_OUTPUT_LINE,
			`${status_icons.FAIL_ICON} check:related failed: test:related`,
		])
	})
})
