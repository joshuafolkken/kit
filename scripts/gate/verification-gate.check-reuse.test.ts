import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { review_tree } from '#scripts/review/review-tree'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckRecords } from './check-reuse'
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
const scratch = mkdtempSync(path.join(tmpdir(), 'verification-gate-check-reuse-test-'))
const TREE: GateTree = { files: { [path.join('scripts', 'a.ts')]: 'digest-a' }, base: 'base-a' }
const SCOPED_CHECKS = 3

function check_records(): CheckRecords {
	const directory = mkdtempSync(path.join(scratch, 'checks-'))

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

// How many checks a green gate started, its whole-gate record cleared afterwards.
async function processes_started(options: GateOptions): Promise<number> {
	mocked_execa.mockClear()
	const stdout = gate_test_fixture.capture_stdout()

	try {
		await verification_gate.run_verification_gate({ ...RECORDS, ...options })
	} finally {
		stdout.restore()
		RECORDS.clear()
	}

	return check_processes()
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
	rmSync(scratch, { force: true, recursive: true })
})

describe('run_verification_gate — the per-check records', () => {
	it('reuses lint, the type check and exports on the next gate over the same inputs', async () => {
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
