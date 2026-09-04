import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { changed_paths } from './git/changed-paths'
import { git_command } from './git/git-command'
import { lint_parallel } from './lint-parallel'
import { lint_related } from './lint-related'

vi.mock('./git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('./git/changed-paths', () => ({ changed_paths: { read_changed_paths: vi.fn() } }))
vi.mock('./lint-parallel', () => ({
	lint_parallel: { run_lint_checks: vi.fn(), run_lint_parallel_checks: vi.fn() },
}))

const mocked_root = vi.mocked(git_command.repository_root)
const mocked_changed = vi.mocked(changed_paths.read_changed_paths)
const mocked_scoped = vi.mocked(lint_parallel.run_lint_checks)
const mocked_whole_tree = vi.mocked(lint_parallel.run_lint_parallel_checks)

// joshuafolkken/kit#1298: the narrowed run is only worth having if the fallbacks reach the whole
// tree rather than checking nothing, so both branches are asserted by which runner they called.

// Real paths in this repository, because the CLI drops a path the tree does not hold — a fixture
// name would be filtered out before the assertion could see it.
const REPOSITORY_ROOT = process.cwd()
const CHANGED_SOURCE = path.join('scripts', 'lint-related.ts')
const ABSOLUTE_SOURCE = path.join(REPOSITORY_ROOT, CHANGED_SOURCE)
const MISSING_FILE = 'no-such-file.ts'
const GIT_FAILURE = 'not a git repository'
const FAILED = 1

function written_output(): string {
	return vi
		.mocked(process.stdout.write)
		.mock.calls.map((call) => String(call[0]))
		.join('')
}

function eslint_arguments(): ReadonlyArray<string> {
	return mocked_scoped.mock.calls[0]?.[1] ?? []
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	mocked_root.mockResolvedValue(REPOSITORY_ROOT)
	mocked_changed.mockResolvedValue([CHANGED_SOURCE])
	mocked_scoped.mockResolvedValue(0)
	mocked_whole_tree.mockResolvedValue(0)
})

describe('lint_related.run_related_lint', () => {
	it('narrows both linters to the changed files', async () => {
		await lint_related.run_related_lint([])

		expect(mocked_whole_tree).not.toHaveBeenCalled()
		expect(mocked_scoped.mock.calls[0]?.[0]).toContain(ABSOLUTE_SOURCE)
		expect(eslint_arguments()).toContain(ABSOLUTE_SOURCE)
	})

	it('reports the narrowing it applied before either linter starts', async () => {
		await lint_related.run_related_lint([])

		expect(written_output()).toContain(CHANGED_SOURCE)
	})

	it('checks the whole tree when the changed files could not be read', async () => {
		mocked_changed.mockRejectedValue(new Error(GIT_FAILURE))

		await lint_related.run_related_lint([])

		expect(mocked_whole_tree).toHaveBeenCalledOnce()
		expect(mocked_scoped).not.toHaveBeenCalled()
		expect(written_output()).toContain('checking the whole tree instead')
	})

	it('checks the whole tree rather than nothing when no changed file is one it reads', async () => {
		mocked_changed.mockResolvedValue(['logo.png'])

		await lint_related.run_related_lint([])

		expect(mocked_whole_tree).toHaveBeenCalledOnce()
	})

	it('returns the exit code the linters reported', async () => {
		mocked_scoped.mockResolvedValue(FAILED)

		await expect(lint_related.run_related_lint([])).resolves.toBe(FAILED)
	})
})

describe('lint_related.run_related_lint — what it is told to narrow by', () => {
	it('prefers explicit file arguments over the git reading', async () => {
		await lint_related.run_related_lint([CHANGED_SOURCE])

		expect(mocked_changed).not.toHaveBeenCalled()
		expect(eslint_arguments()).toContain(ABSOLUTE_SOURCE)
	})

	// Round 2 of joshuafolkken/kit#1298: without this, a refactor that drops the call discards
	// `--fix` again with the whole suite still green.
	it('names a flag it did not forward, because the two linters take different ones', async () => {
		await lint_related.run_related_lint(['--fix'])

		expect(written_output()).toContain('--fix')
		expect(eslint_arguments()).not.toContain('--fix')
	})

	it('names an argument it could not use instead of silently checking everything', async () => {
		await lint_related.run_related_lint([path.join('scripts', MISSING_FILE)])

		expect(written_output()).toContain(MISSING_FILE)
		expect(mocked_whole_tree).toHaveBeenCalledOnce()
	})
})
