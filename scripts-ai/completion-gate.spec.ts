import { describe, expect, it } from 'vitest'
import {
	COMPLETION_GATE_STEPS,
	GATE_CHECK_CI,
	GATE_CSPELL,
	GATE_LINT,
	GATE_TEST_UNIT,
} from './completion-gate'

describe('completion gate steps', () => {
	it('includes the strict CI type-check (check:ci) command', () => {
		expect(COMPLETION_GATE_STEPS).toContain(GATE_CHECK_CI)
	})

	it('uses check:ci (svelte-check), not the incremental fast variant', () => {
		const check_step = COMPLETION_GATE_STEPS.find((step) => step.includes('check'))

		expect(check_step).toBe(GATE_CHECK_CI)
		expect(COMPLETION_GATE_STEPS).not.toContain('pnpm run check')
	})

	it('runs lint before the type-check', () => {
		const lint_index = COMPLETION_GATE_STEPS.indexOf(GATE_LINT)
		const check_index = COMPLETION_GATE_STEPS.indexOf(GATE_CHECK_CI)

		expect(lint_index).toBeGreaterThanOrEqual(0)
		expect(check_index).toBeGreaterThan(lint_index)
	})

	it('includes cspell and unit tests after the type-check', () => {
		const check_index = COMPLETION_GATE_STEPS.indexOf(GATE_CHECK_CI)
		const cspell_index = COMPLETION_GATE_STEPS.indexOf(GATE_CSPELL)
		const unit_index = COMPLETION_GATE_STEPS.indexOf(GATE_TEST_UNIT)

		expect(cspell_index).toBeGreaterThan(check_index)
		expect(unit_index).toBeGreaterThan(cspell_index)
	})
})
