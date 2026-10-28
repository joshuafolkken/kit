import { afterEach, describe, expect, it, vi } from 'vitest'
import { report_format_reference } from './report-format-reference'
import { report_lint_cli } from './report-lint-cli'

// The `--child-summary` flag routes stdin to the lane child's summary lint; without it the two-layer
// work summary lint answers, as before.

const ENV_KEY = 'JOSH_SESSION_LANG'
const FLAG = '--child-summary'
const CHILD_SUMMARY = '- **Cause**: x\n- **Fix**: y\n- **Result**: z'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

function capture(summary: string, argv: ReadonlyArray<string>): { code: number; output: string } {
	const lines: Array<string> = []

	vi.stubEnv(ENV_KEY, 'en')
	vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		lines.push(String(line))
	})
	vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
		lines.push(String(line))
	})
	const code = report_lint_cli.run(summary, argv)

	return { code, output: lines.join('\n') }
}

describe('report_lint_cli.run — --child-summary', () => {
	it('prints ok and exits 0 for a conforming child summary', () => {
		expect(capture(CHILD_SUMMARY, [FLAG])).toEqual({ code: 0, output: 'ok' })
	})

	it('prints the violations and the child summary section, exiting 1', () => {
		const { code, output } = capture('- nothing', [FLAG])

		expect(code).toBe(1)
		expect(output).toContain('✖ missing label: Cause')
		expect(output).toContain(report_format_reference.child_summary_pointer())
	})

	it('checks the two-layer work summary without the flag', () => {
		const { code, output } = capture(CHILD_SUMMARY, [])

		expect(code).toBe(1)
		expect(output).toContain('✖ missing label: ■ Overview')
	})

	it('refuses an empty input in either mode', () => {
		expect(capture(' \n', [FLAG]).code).toBe(1)
	})
})
