import { review_stamps } from '#scripts/review/review-stamps'
import { review_tree } from '#scripts/review/review-tree'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_test_fixture } from './gate-test-fixture'
import { gate_tree } from './gate-tree'

// joshuafolkken/kit#2434: the gate cleared its in-flight marker before it wrote the green record, so
// for tens of milliseconds `run:review --join` read neither a running gate nor a green one and
// answered RED on a gate that passed. The marker must still be held at the moment the green record is
// written, and must be gone once the gate returns — green or red.

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

const PASS = 0
const FAIL = 1
const STABLE_FILE = 'scripts/gate/verification-gate.ts'
const STABLE_TREE: Record<string, string> = { [STABLE_FILE]: 'digest-one' }

const { as_execa_implementation, capture_stdout, fake_result } = gate_test_fixture
const RECORDS = gate_test_fixture.suite_records('marker-order')

function mock_every_step(exit_code: number): void {
	async function fake_execa(): Promise<ReturnType<typeof fake_result>> {
		return fake_result(exit_code, 'step output')
	}

	mocked_execa.mockImplementation(as_execa_implementation(fake_execa))
}

async function run_gate(exit_code: number): Promise<number> {
	mock_every_step(exit_code)
	const stdout = capture_stdout()

	try {
		return await verification_gate.run_verification_gate(RECORDS)
	} finally {
		stdout.restore()
	}
}

// The tree is stubbed to one stable map for the reason `gate-record-warning.test.ts` gives: git cannot
// answer from inside a worker, and a green record is written only on a tree that did not move.
beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(unit_worker_share, 'live_run_count').mockReturnValue(0)
	vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue({ files: STABLE_TREE, base: undefined })
	vi.spyOn(review_tree, 'read_changed_tree').mockResolvedValue(STABLE_TREE)
	RECORDS.clear()
})

afterEach(() => {
	vi.restoreAllMocks()
	RECORDS.clear()
})

describe('the in-flight marker outlives the green record', () => {
	it('is still held when the green record is written', async () => {
		const write = review_stamps.gate_stamp.write.bind(review_stamps.gate_stamp)
		const markers_at_write: Array<unknown> = []

		vi.spyOn(review_stamps.gate_stamp, 'write').mockImplementation((...parameters) => {
			markers_at_write.push(review_stamps.in_flight_stamp.read(RECORDS.marker_path))

			return write(...parameters)
		})

		expect(await run_gate(PASS)).toBe(0)
		expect(markers_at_write).toHaveLength(1)
		expect(markers_at_write[0]).toBeDefined()
	})

	it('is cleared once a green gate returns', async () => {
		await run_gate(PASS)

		expect(review_stamps.in_flight_stamp.read(RECORDS.marker_path)).toBeUndefined()
	})

	it('is cleared once a red gate returns', async () => {
		expect(await run_gate(FAIL)).toBe(FAIL)
		expect(review_stamps.in_flight_stamp.read(RECORDS.marker_path)).toBeUndefined()
	})
})
