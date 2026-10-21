import path from 'node:path'
import { since_green } from '#scripts/gate/since-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { review_stamps } from '#scripts/review/review-stamps'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#4393: a ship retry re-ran every test the whole branch diff reaches. A bare run now
// reads only what moved since its last green run, plus the branch's own test files.

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
	since_green: { describe: vi.fn(), read_moved: vi.fn() },
}))

const mocked_moved = vi.mocked(since_green.read_moved)
const mocked_changed = vi.mocked(changed_paths.read_changed_paths)
const mocked_run = vi.mocked(test_unit_guard.run_guarded_vitest)

// Real paths, because the CLI drops a path the tree does not hold.
const REPOSITORY_ROOT = process.cwd()
const FIXED_SOURCE = path.join('scripts', 'test', 'test-related.ts')
const UNTOUCHED_SOURCE = path.join('scripts', 'test', 'test-related-scope.ts')
const BRANCH_TEST = path.join('scripts', 'test', 'test-related.test.ts')
const NARROWING_LINE = 'since its last green run'

function vitest_arguments(): ReadonlyArray<string> {
	return mocked_run.mock.calls[0]?.[1] ?? []
}

function absolute(file: string): string {
	return path.join(REPOSITORY_ROOT, file)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([])
	vi.mocked(changed_paths.read_held_at).mockResolvedValue([])
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	vi.mocked(since_green.describe).mockReturnValue(NARROWING_LINE)
	vi.spyOn(test_read_map, 'read_map').mockReturnValue(undefined)
	mocked_changed.mockResolvedValue([FIXED_SOURCE, UNTOUCHED_SOURCE, BRANCH_TEST])
	mocked_run.mockResolvedValue(0)
})

describe('test_related.run_related_tests — since the last green run', () => {
	it('reads the moved files from its own green record', async () => {
		mocked_moved.mockResolvedValue([FIXED_SOURCE])

		await test_related.run_related_tests([])

		expect(mocked_moved).toHaveBeenCalledWith(review_stamps.test_related_stamp)
	})

	it('narrows to the moved files and the branch tests, leaving an untouched source out', async () => {
		mocked_moved.mockResolvedValue([FIXED_SOURCE])

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual([
			'related',
			absolute(FIXED_SOURCE),
			absolute(BRANCH_TEST),
			'--run',
		])
	})

	it('runs no tests when nothing moved since the green run', async () => {
		mocked_moved.mockResolvedValue([])

		await expect(test_related.run_related_tests([])).resolves.toBe(0)

		expect(mocked_run).not.toHaveBeenCalled()
		expect(vi.mocked(process.stdout.write)).toHaveBeenCalledWith(
			expect.stringContaining('nothing moved since its last green run'),
		)
	})

	it('says it narrowed since the green run before vitest starts', async () => {
		mocked_moved.mockResolvedValue([FIXED_SOURCE])

		await test_related.run_related_tests([])

		expect(vi.mocked(process.stdout.write)).toHaveBeenCalledWith(`${NARROWING_LINE}\n`)
	})
})

describe('test_related.run_related_tests — reading the whole branch instead', () => {
	it('reads the whole branch change when there is nothing to narrow by', async () => {
		mocked_moved.mockResolvedValue(undefined)

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual([
			'related',
			absolute(FIXED_SOURCE),
			absolute(UNTOUCHED_SOURCE),
			absolute(BRANCH_TEST),
			'--run',
		])
	})

	it('runs the whole suite when the branch change cannot be read', async () => {
		mocked_moved.mockResolvedValue([FIXED_SOURCE])
		mocked_changed.mockRejectedValue(new Error('not a git repository'))

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['run'])
	})

	it('never consults the record for explicit file arguments', async () => {
		await test_related.run_related_tests([UNTOUCHED_SOURCE])

		expect(mocked_moved).not.toHaveBeenCalled()
	})
})

// A branch source that started reading a document after the map's tree is in no map entry, so an
// untouched test reading the document through that source is reached only by the source itself.
describe('test_related.run_related_tests — a moved non-code file', () => {
	const document = 'docs/josh-commands.md'

	it('reads the whole branch change rather than the map readers alone', async () => {
		vi.mocked(test_read_map.read_map).mockReturnValue({
			version: test_read_map.MAP_VERSION,
			commit: 'f00dcafe',
			dirty: [],
			directories: [],
			readers: { [document]: [path.join('scripts', 'test', 'test-related-scope.test.ts')] },
		})
		vi.mocked(changed_paths.read_changed_since).mockResolvedValue([UNTOUCHED_SOURCE, document])
		mocked_moved.mockResolvedValue([document])

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toContain(absolute(UNTOUCHED_SOURCE))
	})
})
