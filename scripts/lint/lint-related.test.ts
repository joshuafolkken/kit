import path from 'node:path'
import { document_byte_check } from '#scripts/document/document-byte-check'
import { gate_plan } from '#scripts/gate/gate-plan'
import { scoped_green } from '#scripts/gate/scoped-green'
import { since_green } from '#scripts/gate/since-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { ESLINT_RELATED_CACHE_FILE } from '#scripts/josh/josh-command-types'
import { review_stamps } from '#scripts/review/review-stamps'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lint_parallel } from './lint-parallel'
import { lint_related } from './lint-related'

vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({ changed_paths: { read_changed_paths: vi.fn() } }))
vi.mock('./lint-parallel', () => ({
	lint_parallel: { run_lint_checks: vi.fn(), run_lint_parallel_checks: vi.fn() },
}))
// **Mocked rather than exercised, because the real one writes the record this checkout's own run
// relies on** (joshuafolkken/kit#1511) — the second-writer trap joshuafolkken/kit#1437 closed for the
// gate records. What belongs to this suite is that the recorder is reached with this run's verdict
// and its arguments; what the recorder then does with them is `scoped-green.test.ts`.
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
// Mocked so no case reads this checkout's real green record; unset, it answers "read the whole branch".
vi.mock('#scripts/gate/since-green', () => ({
	since_green: { UNMOVED_REASON: 'nothing moved', describe: vi.fn(), read_moved: vi.fn() },
}))
// Mocked so the verdict is the mocked lint's alone, never this checkout's real document sizes — an
// unrelated document over its ceiling mid-work failed the whole-tree fallback case here
// (joshuafolkken/kit#3208). The ceilings themselves are `document-byte-check.test.ts`.
vi.mock('#scripts/document/document-byte-check', () => ({
	document_byte_check: { check_all: vi.fn(), check_files: vi.fn() },
}))

const mocked_root = vi.mocked(git_command.repository_root)
const mocked_changed = vi.mocked(changed_paths.read_changed_paths)
const mocked_scoped = vi.mocked(lint_parallel.run_lint_checks)
const mocked_whole_tree = vi.mocked(lint_parallel.run_lint_parallel_checks)
const mocked_record = vi.mocked(scoped_green.record_if_green)
const mocked_before = vi.mocked(scoped_green.read_before)
const mocked_byte_all = vi.mocked(document_byte_check.check_all)
const mocked_byte_files = vi.mocked(document_byte_check.check_files)

// joshuafolkken/kit#1298: the narrowed run is only worth having if the fallbacks reach the whole
// tree rather than checking nothing, so both branches are asserted by which runner they called.

// Real paths in this repository, because the CLI drops a path the tree does not hold — a fixture
// name would be filtered out before the assertion could see it.
const REPOSITORY_ROOT = process.cwd()
const CHANGED_SOURCE = path.join('scripts', 'lint', 'lint-related.ts')
const ABSOLUTE_SOURCE = path.join(REPOSITORY_ROOT, CHANGED_SOURCE)
const MISSING_FILE = 'no-such-file.ts'
const GIT_FAILURE = 'not a git repository'
const FAILED = 1

// The reading taken before the linters start, which the recorder compares against the tree afterwards.
const BEFORE_TREE = { files: { [CHANGED_SOURCE]: 'digest' }, base: 'a22b3479' }

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
	mocked_before.mockResolvedValue(BEFORE_TREE)
	mocked_byte_all.mockReturnValue(0)
	mocked_byte_files.mockReturnValue(0)
})

describe('lint_related.run_related_lint — the green record', () => {
	it('reads the tree before the linters start, so a mid-run edit is visible afterwards', async () => {
		await lint_related.run_related_lint([])

		expect(mocked_before.mock.invocationCallOrder[0]).toBeLessThan(
			mocked_scoped.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('hands the recorder that reading and this run’s verdict', async () => {
		await lint_related.run_related_lint([])

		expect(mocked_record).toHaveBeenCalledWith(review_stamps.lint_related_stamp, {
			before: BEFORE_TREE,
			exit_code: 0,
		})
	})

	it('hands the recorder a failing verdict rather than deciding for it', async () => {
		mocked_scoped.mockResolvedValue(FAILED)

		await lint_related.run_related_lint([])

		expect(mocked_record).toHaveBeenCalledWith(review_stamps.lint_related_stamp, {
			before: BEFORE_TREE,
			exit_code: FAILED,
		})
	})

	it('records the whole-tree fallback too, since it is a superset of the changed files', async () => {
		mocked_changed.mockResolvedValue([])

		await lint_related.run_related_lint([])

		expect(mocked_whole_tree).toHaveBeenCalled()
		expect(mocked_record).toHaveBeenCalledWith(review_stamps.lint_related_stamp, {
			before: BEFORE_TREE,
			exit_code: 0,
		})
	})
})

describe('lint_related.run_related_lint', () => {
	it('narrows both linters to the changed files', async () => {
		await lint_related.run_related_lint([])

		expect(mocked_whole_tree).not.toHaveBeenCalled()
		expect(mocked_scoped.mock.calls[0]?.[0]).toContain(ABSOLUTE_SOURCE)
		expect(eslint_arguments()).toContain(ABSOLUTE_SOURCE)
		expect(mocked_scoped.mock.calls[0]?.[2]).toBe(ESLINT_RELATED_CACHE_FILE)
	})

	// joshuafolkken/kit#4358: the between-edits loop reaches the lane's warm eslint daemon.
	it('asks for the warm eslint daemon on the narrowed run', async () => {
		await lint_related.run_related_lint([])

		expect(mocked_scoped.mock.calls[0]?.[3]).toEqual({ warm_daemon: true })
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

describe('lint_related.run_related_lint — the document byte check', () => {
	it('checks every budgeted document when lint fell back to the whole tree', async () => {
		mocked_changed.mockResolvedValue([])

		await lint_related.run_related_lint([])

		expect(mocked_byte_all).toHaveBeenCalledWith(REPOSITORY_ROOT)
		expect(mocked_byte_files).not.toHaveBeenCalled()
	})

	it('checks only the narrowed files when lint was narrowed', async () => {
		await lint_related.run_related_lint([])

		expect(mocked_byte_files.mock.calls[0]?.[0]).toBe(REPOSITORY_ROOT)
		expect(mocked_byte_files.mock.calls[0]?.[1]).toContain(ABSOLUTE_SOURCE)
		expect(mocked_byte_all).not.toHaveBeenCalled()
	})

	it('skips the byte check when lint already failed', async () => {
		mocked_scoped.mockResolvedValue(FAILED)

		await lint_related.run_related_lint([])

		expect(mocked_byte_files).not.toHaveBeenCalled()
	})

	it('returns and records a byte-check failure after a green lint', async () => {
		mocked_byte_files.mockReturnValue(FAILED)

		await expect(lint_related.run_related_lint([])).resolves.toBe(FAILED)
		expect(mocked_record).toHaveBeenCalledWith(review_stamps.lint_related_stamp, {
			before: BEFORE_TREE,
			exit_code: FAILED,
		})
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

// joshuafolkken/kit#4393: a ship retry re-linted the whole branch diff. A bare run now lints only what
// moved since its last green run, and the whole branch change wherever that cannot be told.
describe('lint_related.run_related_lint — since the last green run', () => {
	const other_source = path.join(REPOSITORY_ROOT, 'scripts', 'lint', 'lint-related-scope.ts')

	beforeEach(() => {
		vi.mocked(since_green.describe).mockReturnValue('since its last green run')
		mocked_changed.mockResolvedValue([CHANGED_SOURCE, path.relative(REPOSITORY_ROOT, other_source)])
	})

	it('lints only the files moved since its own green record', async () => {
		vi.mocked(since_green.read_moved).mockResolvedValue([CHANGED_SOURCE])

		await lint_related.run_related_lint([])

		expect(since_green.read_moved).toHaveBeenCalledWith(
			review_stamps.lint_related_stamp,
			gate_plan.LINT_LABEL,
		)
		expect(eslint_arguments()).toContain(ABSOLUTE_SOURCE)
		expect(eslint_arguments()).not.toContain(other_source)
	})

	it('lints the whole branch change when nothing moved is lintable', async () => {
		vi.mocked(since_green.read_moved).mockResolvedValue(['assets/logo.png'])

		await lint_related.run_related_lint([])

		expect(eslint_arguments()).toEqual(expect.arrayContaining([ABSOLUTE_SOURCE, other_source]))
	})

	it('never consults the record for explicit file arguments', async () => {
		await lint_related.run_related_lint([CHANGED_SOURCE])

		expect(since_green.read_moved).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4593: a re-run with no edit since its green run re-linted the whole branch diff.
describe('lint_related.run_related_lint — nothing moved since the last green run', () => {
	it('returns green without starting a linter or the byte check', async () => {
		vi.mocked(since_green.read_moved).mockResolvedValue([])

		await expect(lint_related.run_related_lint([])).resolves.toBe(0)
		expect(mocked_scoped).not.toHaveBeenCalled()
		expect(mocked_whole_tree).not.toHaveBeenCalled()
		expect(mocked_byte_files).not.toHaveBeenCalled()
		expect(written_output()).toContain(since_green.UNMOVED_REASON)
	})

	// A main sync can move the base while moving no path; a record left on the old base refuses the gate.
	it('still hands the recorder its green verdict, so the record follows a moved base', async () => {
		vi.mocked(since_green.read_moved).mockResolvedValue([])

		await lint_related.run_related_lint([])

		expect(mocked_record).toHaveBeenCalledWith(review_stamps.lint_related_stamp, {
			before: BEFORE_TREE,
			exit_code: 0,
		})
	})

	// No record (a red run writes none, `scoped-green.test.ts`), other inputs, or a moved configuration
	// all answer `undefined` (`since-green.test.ts`).
	it('lints the branch change when the record cannot vouch for this tree', async () => {
		vi.mocked(since_green.read_moved).mockResolvedValue(undefined)

		await lint_related.run_related_lint([])

		expect(eslint_arguments()).toContain(ABSOLUTE_SOURCE)
		expect(mocked_record).toHaveBeenCalledOnce()
	})
})
