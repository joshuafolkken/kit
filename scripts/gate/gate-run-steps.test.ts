import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_plan } from './gate-plan'
import { gate_test_fixture } from './gate-test-fixture'

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

vi.mock('./type-check-step', () => ({
	type_check_step: {
		resolve_type_check_args: async (): Promise<ReadonlyArray<string>> => ['josh', 'check'],
	},
}))

const { gate_run_steps } = await import('./gate-run-steps')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

const MEASURED_CORES = 11
const SERIAL_PLAN = gate_plan.plan_of(1)
const UNRESERVED_BUDGET = { available_cores: MEASURED_CORES, is_reserved: false }
const TAKEN_AT = '2026-10-16T01:02:03.000Z'

async function fake_execa(): Promise<ReturnType<typeof gate_test_fixture.fake_result>> {
	return gate_test_fixture.fake_result(0, '')
}

// joshuafolkken/kit#3903: a check whose inputs did not move since its record is reused, not run.
describe('run_gate_steps — a reused check', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocked_execa.mockImplementation(gate_test_fixture.as_execa_implementation(fake_execa))
	})

	it('starts no process for a reused check and reports when it last passed', async () => {
		const reused = new Map([[gate_plan.LINT_LABEL, TAKEN_AT]])

		const results = await gate_run_steps.run_gate_steps(SERIAL_PLAN, UNRESERVED_BUDGET, reused)
		const lint = results.find((result) => result.label === gate_plan.LINT_LABEL)

		expect(mocked_execa).toHaveBeenCalledTimes(SERIAL_PLAN.checks.length - 1)
		expect(lint).toMatchObject({ exit_code: 0, elapsed_ms: 0, reused_at: TAKEN_AT })
	})

	it('runs every check when none is reused', async () => {
		const results = await gate_run_steps.run_gate_steps(SERIAL_PLAN, UNRESERVED_BUDGET)

		expect(mocked_execa).toHaveBeenCalledTimes(SERIAL_PLAN.checks.length)
		expect(results.every((result) => result.reused_at === undefined)).toBe(true)
	})
})
