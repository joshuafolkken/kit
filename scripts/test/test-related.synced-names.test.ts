import path from 'node:path'
import { since_green } from '#scripts/gate/since-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_related_record } from './test-related-record'
import { test_related_synced } from './test-related-synced'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#5041: after a main sync, a synced file the split cannot vouch for — one main deleted
// or renamed — named main's own sources changed since the map, and vitest widened them to 581 tests.

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
	const original = await import_original()

	return {
		since_green: {
			...original.since_green,
			describe: vi.fn(() => 'since its last green run'),
			read_verdict: vi.fn(),
		},
	}
})

const mocked_run = vi.mocked(test_unit_guard.run_guarded_vitest)

// Real paths, because the CLI drops a path the tree does not hold.
const REPOSITORY_ROOT = process.cwd()
const OWN_SOURCE = path.join('scripts', 'test', 'test-related-record.ts')
const OWN_TEST = path.join('scripts', 'test', 'test-related.synced-names.test.ts')
// What main deleted: its basename is `test-related.ts`, which a comment in `MAIN_SOURCE` names.
const DELETED_BY_MAIN = path.join('tools', 'gone', 'test-related.ts')
const MAIN_SOURCE = path.join('scripts', 'test', 'test-related-main.ts')
const SHARED_TEST = path.join('scripts', 'test', 'test-related-scope.test.ts')

function vitest_arguments(): ReadonlyArray<string> {
	return mocked_run.mock.calls[0]?.[1] ?? []
}

function absolute(file: string): string {
	return path.join(REPOSITORY_ROOT, file)
}

function with_map(): void {
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.spyOn(test_related_synced, 'split').mockResolvedValue({
		left: [],
		shared: [SHARED_TEST],
		meeting: [SHARED_TEST],
	})
	vi.spyOn(test_read_map, 'read_map').mockReturnValue({
		version: test_read_map.MAP_VERSION,
		commit: 'f00dcafe',
		dirty: {},
		change: [],
		directories: [],
		readers: {},
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	with_map()
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([OWN_SOURCE, OWN_TEST])
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([MAIN_SOURCE])
	vi.mocked(changed_paths.read_held_at).mockResolvedValue([])
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	vi.mocked(since_green.read_verdict).mockResolvedValue({
		parts: { changed: [OWN_SOURCE, OWN_TEST], synced: [DELETED_BY_MAIN, SHARED_TEST] },
	})
	mocked_run.mockResolvedValue(0)
})

describe('test_related.run_related_tests — the names a main sync brought in', () => {
	it("hands vitest no source of main's that names only a synced file", async () => {
		await test_related.run_related_tests([])

		expect(vitest_arguments()).not.toContain(absolute(MAIN_SOURCE))
	})

	it('still runs the test the branch changed and the test a synced module shares', async () => {
		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual([
			'related',
			absolute(OWN_SOURCE),
			absolute(OWN_TEST),
			absolute(SHARED_TEST),
			'--run',
		])
	})

	it('still hands it to vitest when it names a file the branch changed', async () => {
		vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([OWN_SOURCE, DELETED_BY_MAIN])

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toContain(absolute(MAIN_SOURCE))
	})

	it("records the branch's own change apart from what the sync brought in", async () => {
		const record_run = vi.spyOn(test_related_record, 'record_run').mockResolvedValue()

		await test_related.run_related_tests([])

		expect(record_run.mock.calls[0]?.[0].branch).toEqual([OWN_SOURCE, OWN_TEST])
	})
})
