import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_test_fixture } from './gate-test-fixture'
import { machine_capacity } from './machine-capacity'

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

const RECORDS = gate_test_fixture.suite_records('ledger')
const scratch = mkdtempSync(path.join(tmpdir(), 'verification-gate-ledger-test-'))
const PASS = 0
const FAIL = 1
const EXTERNAL_CORES = 3

const live_runs = vi.spyOn(unit_worker_share, 'live_run_count')

function mock_every_check(exit_code: number): void {
	async function fake_execa(): Promise<ReturnType<typeof gate_test_fixture.fake_result>> {
		return gate_test_fixture.fake_result(exit_code, '')
	}

	mocked_execa.mockImplementation(gate_test_fixture.as_execa_implementation(fake_execa))
}

async function run_into(ledger_path: string | undefined, exit_code: number): Promise<number> {
	mock_every_check(exit_code)
	const stdout = gate_test_fixture.capture_stdout()

	try {
		return await verification_gate.run_verification_gate({ ...RECORDS, ledger_path })
	} finally {
		stdout.restore()
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	live_runs.mockReturnValue(0)
	RECORDS.clear()
})

afterEach(RECORDS.clear)

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

// joshuafolkken/kit#3355: a finished gate appends its duration and verdict to the lane ledger —
// a failing gate as well, since it cost the lane its time too.
describe('run_verification_gate — the lane ledger', () => {
	it.each([
		[PASS, true],
		[FAIL, false],
	])('records a gate whose checks exit %i as is_passed %s', async (exit_code, is_passed) => {
		const ledger_path = path.join(scratch, `gate-${String(exit_code)}.jsonl`)

		await run_into(ledger_path, exit_code)

		expect(lane_ledger.read_entries(ledger_path)).toMatchObject([{ kind: 'gate', is_passed }])
	})

	it('records the unit suite duration beside the gate duration', async () => {
		const ledger_path = path.join(scratch, 'gate-unit.jsonl')

		await run_into(ledger_path, PASS)

		const [entry] = lane_ledger.read_entries(ledger_path)

		expect(entry?.kind === 'gate' && typeof entry.unit_ms).toBe('number')
	})

	// joshuafolkken/kit#3501: the gate reads the machine before its first check and after its last.
	it('records the external cores the machine was busy with around the checks', async () => {
		const ledger_path = path.join(scratch, 'gate-external.jsonl')
		const busy_cores = machine_capacity.BASELINE_CORES + EXTERNAL_CORES

		vi.spyOn(machine_capacity, 'read_machine').mockResolvedValue({
			busy_cores,
			available_mb: undefined,
		})
		await run_into(ledger_path, PASS)

		expect(lane_ledger.read_entries(ledger_path)).toMatchObject([
			{ kind: 'gate', external_cores: EXTERNAL_CORES },
		])
	})

	it('writes nothing when no ledger was resolved', async () => {
		const record_gate = vi.spyOn(lane_ledger, 'record_gate')

		await run_into(undefined, PASS)

		expect(record_gate).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#1515: a reading between the count and the marker would let another lane miss this gate.
describe('run_verification_gate — the load reading and the run count', () => {
	it('reads the machine before it counts the concurrent runs', async () => {
		const read_machine = vi.spyOn(machine_capacity, 'read_machine').mockResolvedValue({
			busy_cores: machine_capacity.BASELINE_CORES,
			available_mb: undefined,
		})

		await run_into(path.join(scratch, 'gate-order.jsonl'), PASS)

		const [first_read = Infinity] = read_machine.mock.invocationCallOrder
		const [first_count = -Infinity] = live_runs.mock.invocationCallOrder

		expect(first_read).toBeLessThan(first_count)
	})
})
