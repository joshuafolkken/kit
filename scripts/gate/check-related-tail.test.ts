import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { status_icons } from '#scripts/lib/status-icons'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { check_related, type CheckResult } from './check-related'
import { metrics_totals } from './metrics-totals'

const scratch = mkdtempSync(path.join(tmpdir(), 'check-related-tail-test-'))
const LOG_TARGET = path.join(scratch, 'check-related.log')
const [LINT_COMMAND, TEST_COMMAND] = check_related.CHECKS
const LINT_OUTPUT = 'lint output'
const LINT_PASSED = `${status_icons.PASS_ICON} lint:related passed`
const GROWTH_NOTICE = `${metrics_totals.NOTICE_HEADING}\njosh metrics: 1 total(s) grew`
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

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

// joshuafolkken/kit#4939: the notice sat inside the lint section, cut off by a tail of the output.
describe('check_related.report_results metrics growth notice', () => {
	it('repeats the lint section notice just above the log notice and the verdict line', () => {
		const lines = report_with_lint_output(`${LINT_OUTPUT}\n\n${GROWTH_NOTICE}\n`)

		expect(lines.slice(-5)).toStrictEqual([
			...GROWTH_NOTICE.split('\n'),
			'',
			FULL_OUTPUT_LINE,
			`${status_icons.PASS_ICON} check:related passed — ${check_related.METRICS_STOP}`,
		])
	})

	// joshuafolkken/kit#5162: lint:related now closes its own section with a verdict line.
	it('leaves the lint section verdict out of the repeated notice', () => {
		const lines = report_with_lint_output(`${LINT_OUTPUT}\n\n${GROWTH_NOTICE}\n${LINT_PASSED}\n`)

		expect(lines.slice(-5, -2)).toStrictEqual([...GROWTH_NOTICE.split('\n'), ''])
	})

	// joshuafolkken/kit#4987: a tail of the last lines read `passed` alone, and the ship stopped on it.
	it('names the ship stop and the accept form on the verdict line itself', () => {
		const verdict = report_with_lint_output(GROWTH_NOTICE).at(-1) ?? ''

		expect(verdict).toContain('pre-detach')
		expect(verdict).toContain('pnpm josh metrics --accept')
	})

	// The pre-detach re-records a total the branch approval names, so it does not stop on that one.
	it('leaves out of the ship stop a total the branch approval already names', () => {
		const verdict = report_with_lint_output(GROWTH_NOTICE).at(-1) ?? ''

		expect(verdict).toContain('unless the branch approval already names the total')
	})

	it('adds nothing above the log notice when the lint section carries no notice', () => {
		const lines = report_with_lint_output(LINT_OUTPUT)

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
