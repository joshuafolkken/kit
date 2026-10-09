import { describe, expect, it } from 'vitest'
import { gate_own_write } from './gate-own-write'
import { gate_plan } from './gate-plan'
import type { GateStepResult } from './gate-report'

const SOURCE_FILE = 'scripts/gate/gate-report.ts'
const BEFORE: Record<string, string> = { [SOURCE_FILE]: 'digest-one' }
const REWRITTEN: Record<string, string> = { ...BEFORE, [gate_own_write.BASELINE_PATH]: 'lowered' }

function step(label: string, output: string): GateStepResult {
	return { label, command: `josh ${label}`, exit_code: 0, output, elapsed_ms: 1 }
}

const SHRUNK_METRICS = step(
	gate_plan.METRICS_LABEL,
	`josh metrics: no total grew past the baseline — ${gate_own_write.SHRUNK_NOTE}`,
)
const QUIET_METRICS = step(gate_plan.METRICS_LABEL, 'josh metrics: no total grew past the baseline')

describe('gate_own_write.is_unmoved', () => {
	it('passes a tree that did not move', () => {
		expect(gate_own_write.is_unmoved(BEFORE, { ...BEFORE }, [QUIET_METRICS])).toBe(true)
	})

	it("passes a tree whose only change is the metrics step's own baseline rewrite", () => {
		expect(gate_own_write.is_unmoved(BEFORE, REWRITTEN, [SHRUNK_METRICS])).toBe(true)
	})

	it('refuses a baseline that moved without the metrics step saying it rewrote it', () => {
		expect(gate_own_write.is_unmoved(BEFORE, REWRITTEN, [QUIET_METRICS])).toBe(false)
	})

	it('refuses the rewrite note printed by a step other than metrics', () => {
		const other = step(gate_plan.LINT_LABEL, gate_own_write.SHRUNK_NOTE)

		expect(gate_own_write.is_unmoved(BEFORE, REWRITTEN, [other])).toBe(false)
	})

	it('refuses a tree where another file moved beside the rewrite', () => {
		const after = { ...REWRITTEN, [SOURCE_FILE]: 'digest-two' }

		expect(gate_own_write.is_unmoved(BEFORE, after, [SHRUNK_METRICS])).toBe(false)
	})

	it('refuses a file that disappeared from the tree', () => {
		expect(gate_own_write.is_unmoved(BEFORE, {}, [SHRUNK_METRICS])).toBe(false)
	})
})
