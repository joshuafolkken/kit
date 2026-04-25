import { describe, expect, it } from 'vitest'
import {
	COMPLETION_GATE_STEPS,
	GATE_CHECK_CI,
	GATE_CSPELL,
	GATE_LINT,
	GATE_TEST_UNIT,
} from './completion-gate'

describe('completion gate steps', () => {
	it('includes the CI type-check (check:svelte:ci) command', () => {
		expect(COMPLETION_GATE_STEPS).toContain(GATE_CHECK_CI)
	})

	it('uses pnpm josh check:svelte:ci, not pnpm run or the fast incremental variant', () => {
		const check_step = COMPLETION_GATE_STEPS.find((step) => step.includes('check:svelte:ci'))

		expect(check_step).toBe(GATE_CHECK_CI)
		expect(GATE_CHECK_CI).toContain('pnpm josh')
		expect(COMPLETION_GATE_STEPS).not.toContain('pnpm josh check:svelte')
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

	it('uses pnpm josh for the cspell command', () => {
		expect(GATE_CSPELL).toBe('pnpm josh cspell:dot')
	})

	it('uses pnpm josh for the unit test command', () => {
		expect(GATE_TEST_UNIT).toBe('pnpm josh test:unit')
	})
})
