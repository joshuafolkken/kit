import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { review_tree } from '#scripts/review/review-tree'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckRecords } from './check-reuse'
import { gate_plan } from './gate-plan'
import { gate_test_fixture } from './gate-test-fixture'
import { gate_tree, type GateTree } from './gate-tree'
import type { GateOptions } from './verification-gate'

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

// joshuafolkken/kit#3903: a gate records each scoped check green on its own, and the next gate over the
// same inputs starts no process for it. The whole-gate record is cleared between the two runs, so the
// skip one layer out cannot answer instead. Git runs through the mocked `execa` too, so the tree the
// gate reads and the repository root are planted rather than read.

const RECORDS = gate_test_fixture.suite_records('check-reuse')
const make_directory = temporary_directory('suite')
const TREE: GateTree = { files: { [path.join('scripts', 'a.ts')]: 'digest-a' }, base: 'base-a' }
// lint, the type check, cspell (joshuafolkken/kit#5156) and — through the test-read map — the unit step
// (joshuafolkken/kit#4314). Exports and metrics are the ship's and CI's (joshuafolkken/kit#7030).
const SCOPED_CHECKS = 4

function check_records(): CheckRecords {
	const directory = make_directory('verification-gate-check-reuse-test-checks-')

	return function record_of(label: string): string {
		return path.join(directory, `${label}.json`)
	}
}

function check_processes(): number {
	return mocked_execa.mock.calls.filter(([file]) => file === 'pnpm').length
}

async function fake_execa(): Promise<ReturnType<typeof gate_test_fixture.fake_result>> {
	return gate_test_fixture.fake_result(0, '')
}

// How many checks a green gate started, its whole-gate record left in place.
async function processes_kept(options: GateOptions): Promise<number> {
	mocked_execa.mockClear()
	const stdout = gate_test_fixture.capture_stdout()

	try {
		await verification_gate.run_verification_gate({ ...RECORDS, ...options })
	} finally {
		stdout.restore()
	}

	return check_processes()
}

// How many checks a green gate started, its whole-gate record cleared afterwards.
async function processes_started(options: GateOptions): Promise<number> {
	try {
		return await processes_kept(options)
	} finally {
		RECORDS.clear()
	}
}

beforeEach(() => {
	vi.spyOn(unit_worker_share, 'live_run_count').mockReturnValue(0)
	vi.spyOn(git_command, 'repository_root').mockResolvedValue(PROJECT_ROOT)
	vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue(TREE)
	vi.spyOn(review_tree, 'read_changed_tree').mockResolvedValue(TREE.files)
	mocked_execa.mockImplementation(gate_test_fixture.as_execa_implementation(fake_execa))
})

afterAll(() => {
	RECORDS.clear()
})

describe('run_verification_gate — the per-check records', () => {
	it('reuses every scoped check, the unit step included, on the next gate over the same inputs', async () => {
		const options = { check_records: check_records() }
		const first = await processes_started(options)

		await expect(processes_started(options)).resolves.toBe(first - SCOPED_CHECKS)
	})

	it('reuses nothing under --force', async () => {
		const check_records_of = check_records()
		const first = await processes_started({ check_records: check_records_of })
		const forced = { check_records: check_records_of, is_forced: true }

		await expect(processes_started(forced)).resolves.toBe(first)
	})

	it('records nothing from a --no-unit gate', async () => {
		const check_records_of = check_records()
		const full = await processes_started({ check_records: check_records() })

		await processes_started({ check_records: check_records_of, is_unit_included: false })

		await expect(processes_started({ check_records: check_records_of })).resolves.toBe(full)
	})
})

// joshuafolkken/kit#7030: a lane's green gate never ran exports or metrics, so the ship's `--whole-tree`
// gate reuses that record only once both checks' own records are reusable too.
describe('run_verification_gate — a --whole-tree gate over a green lane gate', () => {
	const whole_tree = gate_plan.whole_tree_labels().length

	it('runs the whole-tree checks on top of a lane rerun when their records are missing', async () => {
		const options = { check_records: check_records() }

		await processes_started(options)
		const lane_rerun = await processes_kept(options)

		await expect(processes_started({ ...options, is_whole_tree_included: true })).resolves.toBe(
			lane_rerun + whole_tree,
		)
	})

	it('reuses the green record once the whole-tree checks have records of their own', async () => {
		const options = { check_records: check_records(), is_whole_tree_included: true }

		await processes_kept(options)

		await expect(processes_started(options)).resolves.toBe(0)
	})
})
