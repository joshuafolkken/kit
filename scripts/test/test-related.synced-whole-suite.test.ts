import path from 'node:path'
import { since_green } from '#scripts/gate/since-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#4993: a main sync brought in `tools/test/test-state-guard.ts`, which every test
// depends on, and a bare run after it went to the whole suite though this branch had not changed it.

vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: {
		read_changed_paths: vi.fn(),
		read_changed_since: vi.fn(),
		read_held_at: vi.fn(),
	},
}))
vi.mock('./test-unit-guard', () => ({
	test_unit_guard: { is_running: vi.fn(), run_guarded_vitest: vi.fn() },
}))
// Mocked so no case writes the record this checkout's own run relies on (joshuafolkken/kit#1511).
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
vi.mock('#scripts/gate/since-green', () => ({
	since_green: { describe: vi.fn(() => 'since its last green run'), read_moved_parts: vi.fn() },
}))

const mocked_moved = vi.mocked(since_green.read_moved_parts)
const mocked_changed = vi.mocked(changed_paths.read_changed_paths)
const mocked_run = vi.mocked(test_unit_guard.run_guarded_vitest)

// Real paths, because the CLI drops a path the tree does not hold.
const REPOSITORY_ROOT = process.cwd()
const FIXED_SOURCE = path.join('scripts', 'test', 'test-related.ts')
const STATE_GUARD = path.join('tools', 'test', 'test-state-guard.ts')
const WHOLE_SUITE = ['run']
const NOT_A_REPOSITORY = new Error('not a git repository')

function vitest_arguments(): ReadonlyArray<string> {
	return mocked_run.mock.calls[0]?.[1] ?? []
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([])
	vi.mocked(changed_paths.read_held_at).mockResolvedValue([])
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	vi.spyOn(test_read_map, 'read_map').mockReturnValue({
		version: test_read_map.MAP_VERSION,
		commit: 'f00dcafe',
		dirty: {},
		change: [],
		directories: [],
		readers: {},
	})
	mocked_changed.mockResolvedValue([FIXED_SOURCE])
	mocked_moved.mockResolvedValue({ changed: [FIXED_SOURCE], synced: [STATE_GUARD] })
	mocked_run.mockResolvedValue(0)
})

describe('test_related.run_related_tests — a whole-suite file a main sync brought in', () => {
	it("runs only the branch change's related tests rather than the whole suite", async () => {
		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual([
			'related',
			path.join(REPOSITORY_ROOT, FIXED_SOURCE),
			'--run',
		])
	})

	it('still runs the whole suite when this branch changed it too', async () => {
		mocked_changed.mockResolvedValue([FIXED_SOURCE, STATE_GUARD])

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(WHOLE_SUITE)
	})

	it('still runs the whole suite when the branch change cannot be read', async () => {
		mocked_changed.mockRejectedValue(NOT_A_REPOSITORY)

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(WHOLE_SUITE)
	})
})
