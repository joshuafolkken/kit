import path from 'node:path'
import { core_budget } from '#scripts/gate/core-budget'
import { scoped_green } from '#scripts/gate/scoped-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_logic } from './test-pinned-logic'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_related_record } from './test-related-record'
import { test_related_select } from './test-related-select'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#5532, #7976: a change past the cap runs the selected test files alone, prints and
// records how many were deferred to CI with the hub, and names no argument as one vitest was not given.

vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: {
		read_changed_parts: vi.fn(),
		read_changed_paths: vi.fn(),
		read_changed_since: vi.fn(),
		read_held_at: vi.fn(),
	},
}))
vi.mock('./related-heavy-tests', () => ({ related_heavy_tests: { exclude_flags: () => [] } }))
vi.mock('./test-unit-guard', () => ({
	test_unit_guard: { is_running: vi.fn(), run_guarded_vitest: vi.fn() },
}))
// Mocked so no case writes the record this checkout's own run relies on (joshuafolkken/kit#1511).
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
vi.mock(import('#scripts/gate/since-green'), async (import_original) => {
	const { since_green } = await import_original()
	const no_record = { fallback: since_green.FALLBACK.NO_RECORD }

	return { since_green: { ...since_green, read_verdict: vi.fn(async () => no_record) } }
})
vi.mock('./test-pinned-reach')
// What the cap cut is fed by each case; the cut itself is `test-related-select.test.ts`.
vi.mock('./test-related-select', async () => await import('./test-related-select-fixture'))

const REPOSITORY_ROOT = process.cwd()
const CHANGED_SOURCE = path.join('scripts', 'test', 'test-related-cap.ts')
const SELECTED_TEST = path.join('scripts', 'test', 'test-related-cap.test.ts')
const DEFERRED = 5
const OVER_CAP = test_pinned_logic.MAX_TEST_FILES + DEFERRED

function written_output(): string {
	return vi
		.mocked(process.stdout.write)
		.mock.calls.map((call) => String(call[0]))
		.join('')
}

// No recorded read map, and the claim runs its body without touching the machine-wide ledger.
function stub_machine_state(): void {
	vi.spyOn(test_read_map, 'read_map').mockReturnValue(undefined)
	vi.spyOn(core_budget, 'is_covered').mockReturnValue(false)
	vi.spyOn(core_budget, 'with_command_reservation').mockImplementation(
		async (_weight, run) => await run(),
	)
}

// The branch change is `CHANGED_SOURCE` alone, read from this repository.
function stub_change(): void {
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([CHANGED_SOURCE])
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([])
	vi.mocked(changed_paths.read_held_at).mockResolvedValue([])
}

beforeEach(() => {
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	stub_machine_state()
	stub_change()
	vi.mocked(scoped_green.read_before).mockResolvedValue(undefined)
	vi.mocked(test_unit_guard.run_guarded_vitest).mockResolvedValue(0)
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	vi.mocked(test_related_select.select).mockResolvedValue({
		tests: [SELECTED_TEST],
		deferred: DEFERRED,
		reach: [{ file: CHANGED_SOURCE, count: OVER_CAP }],
		method: 'import',
	})
})

describe('test_related.run_related_tests — a change past the cap', () => {
	it('prints the deferred count with the hub and records it', async () => {
		const record = vi.spyOn(test_related_record, 'record_run')

		await test_related.run_related_tests([])

		expect(written_output()).toContain(
			`${String(DEFERRED)} deferred to CI past the cap (150 test files), hub ${CHANGED_SOURCE}`,
		)
		expect(record.mock.calls[0]?.[0].deferred).toBe(DEFERRED)
	})

	it('hands vitest the selected test files alone', async () => {
		await test_related.run_related_tests([])

		const argv = vi.mocked(test_unit_guard.run_guarded_vitest).mock.calls[0]?.[1]

		expect(argv?.slice(0, 2)).toStrictEqual(['run', path.join(REPOSITORY_ROOT, SELECTED_TEST)])
	})

	it('does not name a capped argument as one vitest was not given', async () => {
		await test_related.run_related_tests([CHANGED_SOURCE])

		expect(written_output()).toContain('deferred to CI')
		expect(written_output()).not.toContain('not a file this check reads')
	})
})

// joshuafolkken/kit#6982: the run hands the branch change by half and base to its record.
describe('test_related.run_related_tests — the branch change by half and base', () => {
	it('passes the halves git read into the recorded input', async () => {
		const branch_parts = { tracked: [CHANGED_SOURCE], untracked: [], base: 'merge_base' as const }

		vi.mocked(changed_paths.read_changed_parts).mockResolvedValue(branch_parts)
		const record = vi.spyOn(test_related_record, 'record_run')

		await test_related.run_related_tests([])

		expect(record.mock.calls[0]?.[0].branch_parts).toStrictEqual(branch_parts)
	})
})
