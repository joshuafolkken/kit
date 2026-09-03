import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { changed_paths } from './git/changed-paths'
import { git_command } from './git/git-command'
import { test_related } from './test-related'
import { test_unit_guard } from './test-unit-guard'

vi.mock('./git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('./git/changed-paths', () => ({ changed_paths: { read_changed_paths: vi.fn() } }))
vi.mock('./test-unit-guard', () => ({ test_unit_guard: { run_guarded_vitest: vi.fn() } }))

const mocked_root = vi.mocked(git_command.repository_root)
const mocked_changed = vi.mocked(changed_paths.read_changed_paths)
const mocked_run = vi.mocked(test_unit_guard.run_guarded_vitest)

// Real paths in this repository, because the CLI drops a path the tree does not hold — a fixture
// name would be filtered out before the assertion could see it.
const REPOSITORY_ROOT = process.cwd()
const CHANGED_SOURCE = path.join('scripts', 'test-related.ts')
const ABSOLUTE_SOURCE = path.join(REPOSITORY_ROOT, CHANGED_SOURCE)
const MISSING_FILE = 'no-such-file.ts'
const GIT_FAILURE = 'not a git repository'

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

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	mocked_root.mockResolvedValue(REPOSITORY_ROOT)
	mocked_changed.mockResolvedValue([CHANGED_SOURCE])
	mocked_run.mockResolvedValue(0)
})

describe('test_related.read_changed_files', () => {
	it('resolves the changed paths against the repository root', async () => {
		await expect(test_related.read_changed_files(REPOSITORY_ROOT)).resolves.toEqual([
			ABSOLUTE_SOURCE,
		])
	})

	it('answers undefined — not an empty list — when git cannot be read', async () => {
		mocked_changed.mockRejectedValue(new Error(GIT_FAILURE))

		await expect(test_related.read_changed_files(REPOSITORY_ROOT)).resolves.toBeUndefined()
	})
})

describe('test_related.repository_root_or_cwd', () => {
	it('falls back to the working directory when git cannot answer', async () => {
		mocked_root.mockRejectedValue(new Error('no repository'))

		await expect(test_related.repository_root_or_cwd()).resolves.toBe(process.cwd())
	})
})

describe('test_related.run_related_tests', () => {
	it('narrows the run to the changed files', async () => {
		await test_related.run_related_tests([])

		expect(vitest_arguments()).toEqual(['related', ABSOLUTE_SOURCE, '--run'])
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
})
