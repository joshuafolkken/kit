import path from 'node:path'
import { core_budget } from '#scripts/gate/core-budget'
import { scoped_green } from '#scripts/gate/scoped-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_logic } from './test-pinned-logic'
import { test_pinned_reach } from './test-pinned-reach'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_related_record } from './test-related-record'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#5532: a changed file past the reach cap is printed as over cap, recorded so, and not
// named as an argument vitest was not given.

vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: {
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

const REPOSITORY_ROOT = process.cwd()
const CHANGED_SOURCE = path.join('scripts', 'test', 'test-related-cap.ts')
const OVER_CAP = test_pinned_logic.MAX_TEST_FILES + 1

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
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	stub_machine_state()
	stub_change()
	vi.mocked(scoped_green.read_before).mockResolvedValue(undefined)
	vi.mocked(test_unit_guard.run_guarded_vitest).mockResolvedValue(0)
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	vi.mocked(test_pinned_reach.reached_test_counts).mockImplementation(async (files) => {
		await Promise.resolve()

		return files.map((file) => ({ file, count: OVER_CAP }))
	})
})

describe('test_related.run_related_tests — a file past the reach cap', () => {
	it('prints it as over cap and records the count', async () => {
		const record = vi.spyOn(test_related_record, 'record_run')

		await test_related.run_related_tests([])

		expect(written_output()).toContain(`1 over cap (150 test files)`)
		expect(record.mock.calls[0]?.[0].over_cap).toEqual([CHANGED_SOURCE])
	})

	it('does not name an over-cap argument as one vitest was not given', async () => {
		await test_related.run_related_tests([CHANGED_SOURCE])

		expect(written_output()).toContain('1 over cap')
		expect(written_output()).not.toContain('not a file this check reads')
	})
})
