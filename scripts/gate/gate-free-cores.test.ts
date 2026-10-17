import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_test_fixture, type ExecaResult } from './gate-test-fixture'

// joshuafolkken/kit#3945: the gate's unit cap is the smaller of the run count's share and the cores
// free of load from outside the core budget's ledger. Only the CLI entry reads the machine, so this
// suite hands the reading in.
//
// A separate file rather than more of `verification-gate.test.ts`, which is at its 300-line limit.

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

vi.mock('./type-check-step', () => ({
	type_check_step: {
		resolve_type_check_args: async (): Promise<ReadonlyArray<string>> => ['josh', 'check'],
	},
}))

const { verification_gate } = await import('./verification-gate')
const { unit_worker_share } = await import('#scripts/test/unit-worker-share')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

const PASS = 0
const SCARCE_FREE = 1
const { as_execa_implementation, capture_stdout, fake_result } = gate_test_fixture
const RECORDS = gate_test_fixture.suite_records('free-cores')

function every_step_passes(): void {
	mocked_execa.mockImplementation(
		as_execa_implementation(async (): Promise<ExecaResult> => fake_result(PASS, 'output')),
	)
}

async function plan_line(read_free_cores?: () => Promise<number | undefined>): Promise<string> {
	const stdout = capture_stdout()

	try {
		await verification_gate.run_verification_gate({ ...RECORDS, read_free_cores })
	} finally {
		stdout.restore()
	}

	return stdout.text().split('\n', 1)[0] ?? ''
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(unit_worker_share, 'live_run_count').mockReturnValue(0)
	every_step_passes()
	RECORDS.clear()
})

afterEach(() => {
	vi.restoreAllMocks()
	RECORDS.clear()
})

describe('the gate bounds its unit cap by the free cores', () => {
	it('takes the free cores when they are fewer than the cap', async () => {
		const line = await plan_line(async () => SCARCE_FREE)

		expect(line).toContain(`at ${String(SCARCE_FREE)} workers`)
	})

	it('keeps the cap where nothing reads the machine', async () => {
		const line = await plan_line()

		expect(line).not.toContain(`at ${String(SCARCE_FREE)} workers`)
	})
})
