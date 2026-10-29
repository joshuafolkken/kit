import path from 'node:path'
import type { GateTree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { since_green } from '#scripts/gate/since-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { review_stamps } from '#scripts/review/review-stamps'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#5386: the bare run after a red one re-ran the whole reach of the last green record,
// though everything but the failed files had just passed. It now reads the failed files and what moved
// since the red record, and a green there vouches for the full reach.

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
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn(), is_unmoved: vi.fn() },
}))
vi.mock('#scripts/gate/since-green', () => ({
	since_green: { UNMOVED_REASON: '', describe: vi.fn(), read_moved_parts: vi.fn() },
}))

const mocked_moved = vi.mocked(since_green.read_moved_parts)
const mocked_run = vi.mocked(test_unit_guard.run_guarded_vitest)

const REPOSITORY_ROOT = process.cwd()
const BASE = 'base-sha'
const FIXED_SOURCE = path.join('scripts', 'test', 'test-related.ts')
const UNTOUCHED_SOURCE = path.join('scripts', 'test', 'test-related-scope.ts')
const FAILED_TEST = path.join('scripts', 'test', 'test-related-scope-triggers.test.ts')
const BEFORE: GateTree = { files: { [FIXED_SOURCE]: 'blob' }, base: BASE }
const RED_MOVED = { changed: [FIXED_SOURCE], synced: [] }
const GREEN_MOVED = { changed: [FIXED_SOURCE, UNTOUCHED_SOURCE], synced: [] }

function red_record(base: string): FileMapStamp {
	return { taken_at: '', files: BEFORE.files, base, blobs: { [FAILED_TEST]: 'failed' } }
}

function vitest_arguments(): ReadonlyArray<string> {
	return mocked_run.mock.calls[0]?.[1] ?? []
}

function absolute(file: string): string {
	return path.join(REPOSITORY_ROOT, file)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.restoreAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([FIXED_SOURCE, UNTOUCHED_SOURCE])
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([])
	vi.mocked(changed_paths.read_held_at).mockResolvedValue([])
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	vi.mocked(scoped_green.read_before).mockResolvedValue(BEFORE)
	mocked_run.mockResolvedValue(0)
})

beforeEach(() => {
	vi.spyOn(test_read_map, 'read_map').mockReturnValue({
		version: test_read_map.MAP_VERSION,
		commit: 'f00dcafe',
		dirty: {},
		change: [],
		directories: [],
		readers: {},
	})
	vi.spyOn(review_stamps.test_related_red_stamp, 'read').mockReturnValue(red_record(BASE))
	vi.spyOn(review_stamps.test_related_red_stamp, 'write').mockReturnValue('')
	vi.spyOn(review_stamps.test_related_red_stamp, 'remove').mockReturnValue()
	mocked_moved.mockImplementation(async (stamp) =>
		stamp === review_stamps.test_related_red_stamp ? RED_MOVED : GREEN_MOVED,
	)
})

describe('test_related.run_related_tests — after a red run', () => {
	it('reads only the failed files and what moved since the red record', async () => {
		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(
			expect.arrayContaining([absolute(FIXED_SOURCE), absolute(FAILED_TEST)]),
		)
		expect(vitest_arguments()).not.toContain(absolute(UNTOUCHED_SOURCE))
	})

	it('records a full-reach green on the before-tree and clears the red record', async () => {
		await expect(test_related.run_related_tests([])).resolves.toBe(0)

		expect(scoped_green.record_if_green).toHaveBeenCalledWith(review_stamps.test_related_stamp, {
			before: BEFORE,
			exit_code: 0,
		})
		expect(review_stamps.test_related_red_stamp.remove).toHaveBeenCalled()
	})

	it('ignores a red record written on another base and narrows by the green one', async () => {
		vi.mocked(review_stamps.test_related_red_stamp.read).mockReturnValue(red_record('merged-main'))

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toContain(absolute(UNTOUCHED_SOURCE))
		expect(vitest_arguments()).not.toContain(absolute(FAILED_TEST))
	})
})
