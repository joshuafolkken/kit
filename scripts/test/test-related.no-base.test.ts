import path from 'node:path'
import { scoped_green } from '#scripts/gate/scoped-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { review_stamps } from '#scripts/review/review-stamps'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_no_base } from './test-no-base'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_unit_guard } from './test-unit-guard'

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
// Mocked for the reason `test-related.test.ts` gives: the real one writes this checkout's record.
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
vi.mock('#scripts/gate/since-green', () => ({ since_green: { read_moved_parts: vi.fn() } }))

const mocked_run = vi.mocked(test_unit_guard.run_guarded_vitest)
const mocked_record = vi.mocked(scoped_green.record_if_green)

const REPOSITORY_ROOT = process.cwd()
const CHANGED_SOURCE = path.join('scripts', 'git', 'change-base.ts')
// Names the base branch too, but reached this run only through the change since the map's tree.
const JOINED_SOURCE = path.join('scripts', 'git', 'git-status.ts')
const MAP_TREE = 'a'.repeat(40)
const FAILED = 1

function mock_change(): void {
	vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([CHANGED_SOURCE])
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([])
	vi.mocked(changed_paths.read_held_at).mockResolvedValue([])
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	mock_change()
	vi.mocked(scoped_green.read_before).mockResolvedValue(undefined)
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	vi.spyOn(test_read_map, 'read_map').mockReturnValue(undefined)
	vi.spyOn(test_no_base, 'run_if_touched').mockResolvedValue(0)
	mocked_run.mockResolvedValue(0)
})

describe('test_related.run_related_tests — the no-base pass', () => {
	it('hands the changed files and the vitest flags to the no-base pass after a green run', async () => {
		await test_related.run_related_tests(['--silent'])

		expect(test_no_base.run_if_touched).toHaveBeenCalledWith(
			REPOSITORY_ROOT,
			[CHANGED_SOURCE],
			['--silent'],
		)
	})

	it('hands only the branch’s own files, never those the map’s tree joined', async () => {
		vi.spyOn(test_read_map, 'read_map').mockReturnValue({
			version: test_read_map.MAP_VERSION,
			commit: MAP_TREE,
			dirty: {},
			directories: [],
			readers: {},
		})
		vi.mocked(changed_paths.read_changed_since).mockResolvedValue([CHANGED_SOURCE, JOINED_SOURCE])

		await test_related.run_related_tests([])

		expect(test_no_base.run_if_touched).toHaveBeenCalledWith(REPOSITORY_ROOT, [CHANGED_SOURCE], [])
	})

	it('records the no-base pass’s failure as the run’s verdict', async () => {
		vi.mocked(test_no_base.run_if_touched).mockResolvedValue(FAILED)

		await expect(test_related.run_related_tests([])).resolves.toBe(FAILED)
		expect(mocked_record).toHaveBeenCalledWith(review_stamps.test_related_stamp, {
			before: undefined,
			exit_code: FAILED,
		})
	})

	it('skips the no-base pass when the first run already failed', async () => {
		mocked_run.mockResolvedValue(FAILED)

		await expect(test_related.run_related_tests([])).resolves.toBe(FAILED)
		expect(test_no_base.run_if_touched).not.toHaveBeenCalled()
	})
})
