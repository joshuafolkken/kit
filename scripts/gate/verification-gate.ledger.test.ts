import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const RECORDS = gate_test_fixture.suite_records('ledger')
const scratch = mkdtempSync(path.join(tmpdir(), 'verification-gate-ledger-test-'))
const PASS = 0
const FAIL = 1

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

	it('writes nothing when no ledger was resolved', async () => {
		const record_gate = vi.spyOn(lane_ledger, 'record_gate')

		await run_into(undefined, PASS)

		expect(record_gate).not.toHaveBeenCalled()
	})
})
