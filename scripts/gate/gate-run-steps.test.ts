import { beforeEach, describe, expect, it, vi } from 'vitest'
import { check_cpu } from './check-cpu'
import { core_budget } from './core-budget'
import { gate_plan } from './gate-plan'
import { UNIT_WORKER_FLAG } from './gate-steps'
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

// joshuafolkken/kit#4235: a unit claim admitted narrowed past the wait cap ran at its full width.
describe('run_gate_steps — a unit claim admitted narrowed', () => {
	const GRANTED = 2

	beforeEach(() => {
		vi.restoreAllMocks()
		mocked_execa.mockImplementation(gate_test_fixture.as_execa_implementation(fake_execa))
	})

	it('marks only the unit step claim and runs it at the granted workers', async () => {
		const reservation = vi
			.spyOn(core_budget, 'with_core_reservation')
			.mockImplementation(
				async (_weight, run) => await run({ overflow: undefined, granted: GRANTED }, ''),
			)

		await gate_run_steps.run_gate_steps(SERIAL_PLAN, { ...UNRESERVED_BUDGET, is_reserved: true })
		const marks = reservation.mock.calls.map((call) => [call[2]?.command, call[2]?.is_unit])
		const unit_args = mocked_execa.mock.calls
			.map((call) => JSON.stringify(call[1]))
			.find((text) => text.includes(UNIT_WORKER_FLAG))

		expect(marks).toContainEqual([`gate ${gate_plan.UNIT_LABEL}`, true])
		expect(marks.filter(([, is_unit]) => is_unit === true)).toHaveLength(1)
		expect(unit_args).toContain(`${UNIT_WORKER_FLAG}=${String(GRANTED)}`)
	})
})

// joshuafolkken/kit#4451: whether a unit claim's wait for room paid off is read per run.
describe('run_gate_steps — each check claim', () => {
	const ASKED = 7
	const GRANTED = 3
	const WAITED_MS = 4200
	const RESERVED_BUDGET = { ...UNRESERVED_BUDGET, is_reserved: true }

	beforeEach(() => {
		vi.restoreAllMocks()
		mocked_execa.mockImplementation(gate_test_fixture.as_execa_implementation(fake_execa))
	})

	it('returns a claimed check its asked width, its granted width and its wait', async () => {
		vi.spyOn(core_budget, 'with_core_reservation').mockImplementation(
			async (_weight, run) =>
				await run({ overflow: undefined, granted: GRANTED, waited_ms: WAITED_MS }, ''),
		)
		vi.spyOn(gate_plan, 'check_weight').mockReturnValue(ASKED)

		const results = await gate_run_steps.run_gate_steps(SERIAL_PLAN, RESERVED_BUDGET)

		expect(results[0]?.claim).toStrictEqual({
			requested: ASKED,
			granted: GRANTED,
			waited_ms: WAITED_MS,
		})
	})

	it('records a claim admitted as asked at its asked width, with no wait', async () => {
		vi.spyOn(core_budget, 'with_core_reservation').mockImplementation(
			async (_weight, run) => await run({ overflow: undefined }, ''),
		)
		vi.spyOn(gate_plan, 'check_weight').mockReturnValue(ASKED)

		const results = await gate_run_steps.run_gate_steps(SERIAL_PLAN, RESERVED_BUDGET)

		expect(results[0]?.claim).toStrictEqual({ requested: ASKED, granted: ASKED, waited_ms: 0 })
	})
})

// joshuafolkken/kit#4362: the gate ledger records each check's CPU from what the run returns.
describe('run_gate_steps — each check CPU', () => {
	const CHECK_CPU_MS = 1234

	beforeEach(() => {
		vi.restoreAllMocks()
		mocked_execa.mockImplementation(gate_test_fixture.as_execa_implementation(fake_execa))
	})

	it('returns the CPU each check that ran spent, and none for a reused one', async () => {
		vi.spyOn(check_cpu, 'check_cpu_reader').mockReturnValue(() => CHECK_CPU_MS)
		const reused = new Map([[gate_plan.LINT_LABEL, TAKEN_AT]])

		const results = await gate_run_steps.run_gate_steps(SERIAL_PLAN, UNRESERVED_BUDGET, reused)
		const ran = results.filter((result) => result.label !== gate_plan.LINT_LABEL)
		const lint = results.find((result) => result.label === gate_plan.LINT_LABEL)

		expect(ran.map((result) => result.cpu_ms)).toStrictEqual(ran.map(() => CHECK_CPU_MS))
		expect(lint?.cpu_ms).toBeUndefined()
	})
})
