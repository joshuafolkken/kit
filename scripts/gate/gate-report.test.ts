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
