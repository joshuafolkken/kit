import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_test_fixture, type ExecaResult } from './gate-test-fixture'

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

const { as_execa_implementation, capture_stdout, fake_result } = gate_test_fixture

// This suite mocks execa but not the tree, so it must use isolated record destinations: simulated
// success must not authorize skipping checks on the real working tree (joshuafolkken/kit#1328).
const RECORDS = gate_test_fixture.suite_records('sharing')

const live_runs = vi.spyOn(unit_worker_share, 'live_run_count')
const live_lanes = vi.spyOn(unit_worker_share, 'live_lane_count')

async function plan_text(): Promise<string> {
	async function passing_execa(): Promise<ExecaResult> {
		return fake_result(0, 'ok')
	}

	mocked_execa.mockImplementation(as_execa_implementation(passing_execa))
	const stdout = capture_stdout()

	try {
		await verification_gate.run_verification_gate(RECORDS)

		return stdout.text()
	} finally {
		stdout.restore()
	}
}

beforeEach(RECORDS.clear)

afterEach(RECORDS.clear)

// **What `announce_gate_plan` does with the machine's answer** (joshuafolkken/kit#1515). The rest of
// the gate's suites pin the count to a quiet machine, so nothing else would notice the gate going back
// to sizing itself from the core count alone — the defect six lanes were built on.
describe('the gate counts the runs it is sharing the machine with', () => {
	// One other run in flight makes this gate the second, and the line has to say so rather than only
	// narrow: a lane owner reading a one-worker gate must not have to derive the reason. Live lanes
	// whose suites have not started yet hold their share too (joshuafolkken/kit#6682).
	it.each([
		{ runs: 1, lanes: 0, sharing: 2 },
		{ runs: 0, lanes: 3, sharing: 3 },
	])('names them in the plan line: $runs other runs, $lanes lanes', async (sample) => {
		live_runs.mockReturnValue(sample.runs)
		live_lanes.mockReturnValue(sample.lanes)

		expect(await plan_text()).toMatch(
			new RegExp(String.raw`^plan: .*, ${String(sample.sharing)} unit runs or lanes\)`, 'mu'),
		)
	})
})
