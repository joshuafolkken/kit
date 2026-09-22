import { describe, expect, it } from 'vitest'
import { gate_report, type GateStepResult } from './gate-report'

// joshuafolkken/kit#2296: the failure-action summary is the tail line a `tail` of a red gate keeps.
// The rest of `gate-report.ts` is exercised end to end by `verification-gate.test.ts`.

function result_of(label: string, command: string, exit_code: number): GateStepResult {
	return { label, command, exit_code, output: `output of ${command}`, elapsed_ms: 1 }
}

const PASS = 0
const FAIL = 1

describe('format_failure_actions', () => {
	it('names one re-run command per failing check', () => {
		const block = gate_report.format_failure_actions([
			result_of('lint', 'josh lint', FAIL),
			result_of('cspell', 'josh cspell:dot', FAIL),
		])

		expect(block).toContain('re-run: pnpm josh lint')
		expect(block).toContain('re-run: pnpm josh cspell:dot')
	})

	it('is empty when nothing failed', () => {
		expect(gate_report.format_failure_actions([])).toBe('')
	})
})

describe('is_gate_step_failed', () => {
	it('reads the exit code of the step', () => {
		expect(gate_report.is_gate_step_failed(result_of('lint', 'josh lint', FAIL))).toBe(true)
		expect(gate_report.is_gate_step_failed(result_of('lint', 'josh lint', PASS))).toBe(false)
	})
})

// joshuafolkken/kit#2318: the withholding path is narrower than the print path. A benign line that
// merely contains the word "warning" — a Vite config deprecation on `test:unit` — printed a body but
// must never withhold the green record, because that turns a green gate's `run:review --join` red.
function passed_saying(label: string, output: string): GateStepResult {
	return { label, command: `josh ${label}`, exit_code: PASS, output, elapsed_ms: 1 }
}

const VITE_DEPRECATION =
	"(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`.\n" +
	'Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.'
const ESLINT_WARNING = 'src/a.ts:1:1  warning  Unexpected console statement'

describe('has_checker_warning', () => {
	it.each(['lint', 'check'])('withholds for a %s step that passed with warnings', (label) => {
		expect(gate_report.has_checker_warning(passed_saying(label, ESLINT_WARNING))).toBe(true)
	})

	it('does not withhold for a benign warning line from a non-checker step', () => {
		expect(gate_report.has_checker_warning(passed_saying('test:unit', VITE_DEPRECATION))).toBe(
			false,
		)
	})

	it('does not withhold a checker step that said nothing warning-shaped', () => {
		expect(gate_report.has_checker_warning(passed_saying('lint', 'all files pass'))).toBe(false)
	})
})
