import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { core_budget } from './core-budget'
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

const { verification_gate } = await import('./verification-gate')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

const MEASURED_CORES = 11
const SERIAL_PLAN = gate_plan.plan_of(1)
const UNRESERVED_BUDGET = { available_cores: MEASURED_CORES, is_reserved: false }

// The held mark each check's child process was started with. `run_buffered_process` copies
// `process.env` into the child's environment right before it calls execa, so the value read at the
// call is the value the child inherits.
function capture_child_marks(): Array<string | undefined> {
	const marks: Array<string | undefined> = []

	async function fake_execa(): Promise<ReturnType<typeof gate_test_fixture.fake_result>> {
		marks.push(process.env[core_budget.HELD_KEY])

		return gate_test_fixture.fake_result(0, '')
	}

	mocked_execa.mockImplementation(gate_test_fixture.as_execa_implementation(fake_execa))

	return marks
}

// joshuafolkken/kit#3345: each gate check is a `pnpm josh <target>` child, and a target that declares
// a weight reserves at dispatch. Without the held mark the child would claim a second place for the
// cores the gate already reserved for that check.
describe('run_gate_steps — the checks never reserve their cores twice', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.stubEnv(core_budget.HELD_KEY, '')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('starts every check with the held mark set', async () => {
		const marks = capture_child_marks()

		await verification_gate.run_gate_steps(SERIAL_PLAN, UNRESERVED_BUDGET)

		expect(marks).toHaveLength(SERIAL_PLAN.checks.length)
		expect(new Set(marks)).toEqual(new Set([core_budget.HELD_VALUE]))
	})

	it('clears the mark once the checks are done', async () => {
		capture_child_marks()

		await verification_gate.run_gate_steps(SERIAL_PLAN, UNRESERVED_BUDGET)

		expect(core_budget.is_held()).toBe(false)
	})
})
