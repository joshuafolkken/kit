import path from 'node:path'
import { core_budget } from '#scripts/gate/core-budget'
import { scoped_green } from '#scripts/gate/scoped-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { review_stamps } from '#scripts/review/review-stamps'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { related_heavy_tests } from './related-heavy-tests'
import { test_read_map, type ReadMap } from './test-read-map'
import { test_related } from './test-related'
import { test_related_reuse } from './test-related-reuse'
import { test_unit_guard } from './test-unit-guard'

vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: {
		read_changed_paths: vi.fn(),
		read_changed_since: vi.fn(),
		read_held_at: vi.fn(),
	},
}))
vi.mock('./related-heavy-tests', () => ({
	related_heavy_tests: { exclude_flags: vi.fn(() => []) },
}))
vi.mock('./test-unit-guard', () => ({
	test_unit_guard: {
		is_running: vi.fn(),
		run_guarded_vitest: vi.fn(),
	},
}))
// **Mocked rather than exercised, because the real one writes the record this checkout's own run
// relies on** (joshuafolkken/kit#1511) — the second-writer trap joshuafolkken/kit#1437 closed for the
// gate records. What the recorder does with what it is handed is `scoped-green.test.ts`.
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
// No green record, so every case reads the whole branch change; the since-green narrowing is
// `test-related.since-green.test.ts`.
vi.mock(import('#scripts/gate/since-green'), async (import_original) => {
	const { since_green } = await import_original()
	const no_record = { fallback: since_green.FALLBACK.NO_RECORD }

	return { since_green: { ...since_green, read_verdict: vi.fn(async () => no_record) } }
})
// The claim walks no import graph here; what it claims is `test-related.claim.test.ts`.
vi.mock('./test-pinned-reach', () => ({
	test_pinned_reach: { reached_test_count: vi.fn() },
}))

const mocked_root = vi.mocked(git_command.repository_root)
const mocked_changed = vi.mocked(changed_paths.read_changed_paths)
const mocked_run = vi.mocked(test_unit_guard.run_guarded_vitest)
const mocked_record = vi.mocked(scoped_green.record_if_green)
const mocked_before = vi.mocked(scoped_green.read_before)
const mocked_running = vi.mocked(test_unit_guard.is_running)
const mocked_since = vi.mocked(changed_paths.read_changed_since)
const mocked_held = vi.mocked(changed_paths.read_held_at)

// Real paths in this repository, because the CLI drops a path the tree does not hold — a fixture
// name would be filtered out before the assertion could see it.
const REPOSITORY_ROOT = process.cwd()
const CHANGED_SOURCE = path.join('scripts', 'test', 'test-related.ts')
const ABSOLUTE_SOURCE = path.join(REPOSITORY_ROOT, CHANGED_SOURCE)
const ADDED_TEST = path.join('scripts', 'test', 'test-related.test.ts')
const REUSED_TEST = path.join(REPOSITORY_ROOT, ADDED_TEST)
const MISSING_FILE = 'no-such-file.ts'
const PACKAGE_FILE = 'package.json'
const GIT_FAILURE = 'not a git repository'

// The reading taken before vitest starts, which the recorder compares against the tree afterwards.
const BEFORE_TREE = { files: { [CHANGED_SOURCE]: 'digest' }, base: 'a22b3479' }

// A map recorded on `MAP_COMMIT`, under which the README is read by the changed source.
const MAP_COMMIT = 'f00dcafe'
const DOCUMENT = 'README.md'
const DIRTY_DOCUMENT = 'CHANGELOG.md'
const MAP: ReadMap = {
	version: test_read_map.MAP_VERSION,
	commit: MAP_COMMIT,
	dirty: { [DIRTY_DOCUMENT]: 'digest-then' },
	change: [DIRTY_DOCUMENT],
	directories: [],
	readers: { [DOCUMENT]: [CHANGED_SOURCE], [DIRTY_DOCUMENT]: [CHANGED_SOURCE] },
}

function written_output(): string {
	return vi
		.mocked(process.stdout.write)
		.mock.calls.map((call) => String(call[0]))
		.join('')
}

function vitest_arguments(): ReadonlyArray<string> {
	return mocked_run.mock.calls[0]?.[1] ?? []
}

// The narrowing line is handed to the guard rather than printed here, so that a run vitest never
// starts does not announce one.
function announcement(): string {
	return mocked_run.mock.calls[0]?.[3] ?? ''
}

// No recorded read map, and the claim runs its body without touching the machine-wide ledger; what
// it claims is `test-related.claim.test.ts`.
function stub_machine_state(): void {
	vi.spyOn(test_read_map, 'read_map').mockReturnValue(undefined)
	vi.spyOn(core_budget, 'is_covered').mockReturnValue(false)
	vi.spyOn(core_budget, 'with_command_reservation').mockImplementation(
		async (_weight, run) => await run(),
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	mocked_root.mockResolvedValue(REPOSITORY_ROOT)
	mocked_changed.mockResolvedValue([CHANGED_SOURCE])
	mocked_run.mockResolvedValue(0)
	mocked_before.mockResolvedValue(BEFORE_TREE)
	mocked_running.mockReturnValue(true)
	mocked_since.mockResolvedValue([])
	mocked_held.mockResolvedValue([])
	stub_machine_state()
})

describe('test_related.run_related_tests — the green record', () => {
	it('hands the recorder the pre-run reading and this run’s verdict', async () => {
		await test_related.run_related_tests([])

		expect(mocked_record).toHaveBeenCalledWith(review_stamps.test_related_stamp, {
			before: BEFORE_TREE,
			exit_code: 0,
		})
	})

	it('hands the recorder a failing verdict rather than deciding for it', async () => {
		const failed = 1

		mocked_run.mockResolvedValue(failed)

		await test_related.run_related_tests([])

		expect(mocked_record).toHaveBeenCalledWith(review_stamps.test_related_stamp, {
			before: BEFORE_TREE,
			exit_code: failed,
		})
	})

	// The skip branch exits 0 having run nothing, so a zero from it must vouch for no tree.
	it('vouches for no tree when the guard would skip vitest rather than run it', async () => {
		mocked_running.mockReturnValue(false)

		await test_related.run_related_tests([])

		expect(mocked_record).toHaveBeenCalledWith(review_stamps.test_related_stamp, {
			before: undefined,
			exit_code: 0,
		})
	})
})

describe('test_related.run_related_tests — individual reuse', () => {
	it('passes the pre-run scope to reuse and excludes its proven tests from the runner', async () => {
		const read = vi.spyOn(test_related_reuse, 'read').mockResolvedValueOnce({
			excluded: [REUSED_TEST],
			reused: 1,
			missed: 0,
			reason: 'closed',
			elapsed_ms: 0,
		})

		vi.spyOn(test_related_reuse, 'retained').mockResolvedValueOnce([])
		vi.spyOn(test_related_reuse, 'blobs').mockResolvedValueOnce({})

		await test_related.run_related_tests([])

		expect(read).toHaveBeenCalledWith(
			REPOSITORY_ROOT,
			expect.objectContaining({ mode: 'related' }),
			BEFORE_TREE,
		)
		expect(vitest_arguments()).toEqual([
			'related',
			ABSOLUTE_SOURCE,
			'--run',
			'--passWithNoTests',
			'--exclude',
			REUSED_TEST,
		])
	})
})

describe('test_related.run_related_tests', () => {
	it('narrows the run to the changed files', async () => {
		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['related', ABSOLUTE_SOURCE, '--run'])
	})

	// joshuafolkken/kit#5105: the heavy files the scope reaches only indirectly stay out of the run.
	it('hands vitest the heavy-file exclusions after the narrowed files', async () => {
		const flags = ['--exclude', 'tools/test/heavy.test.ts']

		vi.mocked(related_heavy_tests.exclude_flags).mockReturnValueOnce(flags)
		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['related', ABSOLUTE_SOURCE, '--run', ...flags])
	})

	it('reports the narrowing it applied, through the guard that decides there is a run', async () => {
		await test_related.run_related_tests([])

		expect(announcement()).toContain(CHANGED_SOURCE)
		expect(written_output()).not.toContain(CHANGED_SOURCE)
	})

	it('runs the whole suite when the changed files could not be read', async () => {
		mocked_changed.mockRejectedValue(new Error(GIT_FAILURE))

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['run'])
		expect(announcement()).toContain('running the full unit suite instead')
	})

	it('runs the whole suite rather than nothing when no changed file has a module', async () => {
		mocked_changed.mockResolvedValue(['README.md'])

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['run'])
	})
})

describe('test_related.run_related_tests — what it is told to narrow by', () => {
	it('prefers explicit file arguments over the git reading', async () => {
		await test_related.run_related_tests([CHANGED_SOURCE])

		expect(mocked_changed).not.toHaveBeenCalled()
		expect(vitest_arguments()).toEqual(['related', ABSOLUTE_SOURCE, '--run'])
	})

	it('names an argument it could not use instead of reporting a change that has none', async () => {
		await test_related.run_related_tests([path.join('scripts', MISSING_FILE)])

		expect(written_output()).toContain(MISSING_FILE)
		expect(vitest_arguments()).toEqual(['run'])
	})

	it('forwards a flag to vitest instead of reading it as a file', async () => {
		await test_related.run_related_tests(['--silent'])

		expect(vitest_arguments()).toEqual(['related', ABSOLUTE_SOURCE, '--run', '--silent'])
	})

	it('names itself in the guard so a skipped run is not reported as the full suite', async () => {
		await test_related.run_related_tests([])

		expect(mocked_run.mock.calls[0]?.[2]).toBe('test:related')
	})

	it('returns the exit code the guarded run reported', async () => {
		mocked_run.mockResolvedValue(1)

		await expect(test_related.run_related_tests([])).resolves.toBe(1)
	})

	it('resolves an explicit document argument through the map', async () => {
		vi.mocked(test_read_map.read_map).mockReturnValue(MAP)

		await test_related.run_related_tests([DOCUMENT])

		expect(vitest_arguments()).toEqual(['related', ABSOLUTE_SOURCE, '--run'])
		expect(written_output()).not.toContain(DOCUMENT)
	})
})

// A test added since the map was recorded is in no map entry, so explicit arguments still read the
// change the map answers for.
describe('test_related.run_related_tests — explicit arguments against a map', () => {
	beforeEach(() => {
		vi.mocked(test_read_map.read_map).mockReturnValue(MAP)
	})

	it('joins the change since the map to the arguments, so a test added since it naming one runs', async () => {
		mocked_since.mockResolvedValue([ADDED_TEST])

		await test_related.run_related_tests([DOCUMENT])

		expect(mocked_since).toHaveBeenCalledWith(MAP_COMMIT)
		expect(vitest_arguments()).toEqual([
			'related',
			path.join(REPOSITORY_ROOT, ADDED_TEST),
			ABSOLUTE_SOURCE,
			'--run',
		])
	})

	it('drops a map whose commit cannot be resolved', async () => {
		mocked_since.mockRejectedValue(new Error(GIT_FAILURE))

		await test_related.run_related_tests([DOCUMENT])

		expect(mocked_changed).not.toHaveBeenCalled()
		expect(vitest_arguments()).toEqual(['run'])
	})
})

// joshuafolkken/kit#4065: a map answers for the change since the tree it was recorded on.
describe('test_related.run_related_tests — the change a map answers for', () => {
	beforeEach(() => {
		vi.mocked(test_read_map.read_map).mockReturnValue(MAP)
	})

	it('reads the change since the map’s commit rather than the branch change', async () => {
		mocked_since.mockResolvedValue([DOCUMENT])
		mocked_changed.mockResolvedValue([DOCUMENT])

		await test_related.run_related_tests([])

		expect(mocked_since).toHaveBeenCalledWith(MAP_COMMIT)
		expect(vitest_arguments()).toEqual(['related', ABSOLUTE_SOURCE, '--run'])
	})

	// joshuafolkken/kit#4527: the map's tree is another lane's, whose own branch change is no trigger here.
	it('sends nothing this branch did not change to the whole suite', async () => {
		mocked_since.mockResolvedValue([CHANGED_SOURCE, PACKAGE_FILE])

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['related', ABSOLUTE_SOURCE, '--run'])
	})

	it('reads every file as moved when the branch change cannot be read', async () => {
		mocked_since.mockResolvedValue([CHANGED_SOURCE, PACKAGE_FILE])
		mocked_changed.mockRejectedValue(new Error(GIT_FAILURE))

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['run'])
	})

	it('counts what already differed from the map’s tree as changed', async () => {
		mocked_changed.mockResolvedValue([DIRTY_DOCUMENT])

		await test_related.run_related_tests([])

		expect(announcement()).toContain(CHANGED_SOURCE)
		expect(vitest_arguments()).toEqual(['related', ABSOLUTE_SOURCE, '--run'])
	})
})

describe('test_related.run_related_tests — a map whose commit cannot be resolved', () => {
	beforeEach(() => {
		vi.mocked(test_read_map.read_map).mockReturnValue(MAP)
	})

	it('drops the map and reads the branch change when its commit cannot be resolved', async () => {
		mocked_since.mockRejectedValue(new Error(GIT_FAILURE))
		mocked_changed.mockResolvedValue([DOCUMENT])

		await test_related.run_related_tests([])

		expect(mocked_changed).toHaveBeenCalledOnce()
		expect(vitest_arguments()).toEqual(['run'])
	})
})

// joshuafolkken/kit#4073: a change made only of files the map's tree held and no test read runs
// nothing, and says so.
describe('test_related.run_related_tests — a change no test reads', () => {
	const UNREAD_DOCUMENT = 'LICENSE'

	beforeEach(() => {
		vi.mocked(test_read_map.read_map).mockReturnValue({ ...MAP, dirty: {} })
		mocked_changed.mockResolvedValue([UNREAD_DOCUMENT])
		mocked_since.mockResolvedValue([UNREAD_DOCUMENT])
		mocked_held.mockResolvedValue([UNREAD_DOCUMENT])
	})

	it('succeeds without starting vitest and prints why', async () => {
		await expect(test_related.run_related_tests([])).resolves.toBe(0)

		expect(mocked_run).not.toHaveBeenCalled()
		expect(core_budget.with_command_reservation).not.toHaveBeenCalled()
		expect(written_output()).toContain('running no tests')
		expect(written_output()).toContain(UNREAD_DOCUMENT)
	})

	it('asks the map’s tree only about non-code files that did not already differ from it', async () => {
		vi.mocked(test_read_map.read_map).mockReturnValue(MAP)
		mocked_since.mockResolvedValue([UNREAD_DOCUMENT, CHANGED_SOURCE])

		await test_related.run_related_tests([])

		expect(mocked_held).toHaveBeenCalledWith(MAP_COMMIT, [UNREAD_DOCUMENT])
	})

	it('runs the whole suite when the map’s tree cannot be read', async () => {
		mocked_held.mockRejectedValue(new Error(GIT_FAILURE))

		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['run'])
	})
})
