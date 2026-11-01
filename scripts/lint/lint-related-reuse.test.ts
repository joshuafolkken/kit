import { metrics_totals } from '#scripts/gate/metrics-totals'
import { scoped_green } from '#scripts/gate/scoped-green'
import { tree_verdict, type TreeVerdict } from '#scripts/gate/tree-verdict'
import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lint_parallel } from './lint-parallel'
import { lint_related } from './lint-related'

// joshuafolkken/kit#5657: a bare run on a tree it already answered for linted it again.

vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('./lint-parallel', () => ({
	lint_parallel: { run_lint_checks: vi.fn(), run_lint_parallel_checks: vi.fn() },
}))
// Mocked so no case reads or writes this checkout's real records.
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
vi.mock(import('#scripts/gate/tree-verdict'), async (import_original) => {
	const { tree_verdict: real } = await import_original()

	return { tree_verdict: { ...real, read: vi.fn(), record: vi.fn() } }
})
// A fresh run's other checks, each mocked green as `lint-related.test.ts` mocks them.
vi.mock(import('#scripts/gate/since-green'), async (import_original) => {
	const { since_green: real } = await import_original()
	const no_record = { fallback: real.FALLBACK.NO_RECORD }

	return { since_green: { ...real, read_verdict: vi.fn(async () => no_record) } }
})
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: vi.fn(async () => []) },
}))
vi.mock('#scripts/document/document-checks', () => ({
	document_checks: { check_all: vi.fn(() => 0), check_files: vi.fn(() => 0) },
}))
vi.mock('#scripts/exports/unused-members-check', () => ({
	unused_members_check: { run_unused_members: vi.fn(async () => 0) },
}))
vi.mock('#scripts/gate/structural-checks', () => ({
	structural_checks: { run_structural: vi.fn(async () => 0) },
}))
vi.mock('#scripts/gate/metrics-totals', () => ({
	metrics_totals: { growth_notice: vi.fn() },
}))

const GROWTH_NOTICE = 'josh metrics: 1 total(s) grew past the merge-base'
const SOURCE = 'scripts/a.ts'
const BEFORE_TREE = { files: { [SOURCE]: 'digest' }, base: 'a22b3479' }
const FAILED = 1

function kept(exit_code: number): TreeVerdict {
	return { tree: 'b'.repeat(64), exit_code, tail: '\nkept lint tail\n', at: 'then' }
}

function written_output(): string {
	return vi
		.mocked(process.stdout.write)
		.mock.calls.map((call) => String(call[0]))
		.join('')
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.mocked(git_command.repository_root).mockResolvedValue(process.cwd())
	vi.mocked(scoped_green.read_before).mockResolvedValue(BEFORE_TREE)
})

describe('lint_related.run_related_lint on a tree it already answered for', () => {
	it('lints nothing and prints the kept green verdict', async () => {
		vi.mocked(tree_verdict.read).mockReturnValue(kept(0))

		await expect(lint_related.run_related_lint([])).resolves.toBe(0)

		expect(tree_verdict.read).toHaveBeenCalledWith(BEFORE_TREE, expect.any(String))
		expect(lint_parallel.run_lint_checks).not.toHaveBeenCalled()
		expect(lint_parallel.run_lint_parallel_checks).not.toHaveBeenCalled()
		expect(scoped_green.record_if_green).not.toHaveBeenCalled()
		expect(written_output()).toBe(
			`reused: tree ${'b'.repeat(12)} green at then\n\nkept lint tail\n`,
		)
	})

	it('answers a kept red verdict red without linting', async () => {
		vi.mocked(tree_verdict.read).mockReturnValue(kept(FAILED))

		await expect(lint_related.run_related_lint([])).resolves.toBe(FAILED)

		expect(lint_parallel.run_lint_parallel_checks).not.toHaveBeenCalled()
		expect(written_output()).toContain(' red at then — remove ')
	})
})

describe('lint_related.run_related_lint on a tree it has not answered for', () => {
	it('keeps the tail it printed, the growth notice in it, for a re-run on the same tree', async () => {
		vi.mocked(tree_verdict.read).mockReturnValue(undefined)
		vi.mocked(lint_parallel.run_lint_parallel_checks).mockResolvedValue(0)
		vi.mocked(metrics_totals.growth_notice).mockResolvedValue(GROWTH_NOTICE)

		await expect(lint_related.run_related_lint([])).resolves.toBe(0)

		const [entry] = vi.mocked(tree_verdict.record).mock.calls[0] ?? []

		expect(entry).toMatchObject({ before: BEFORE_TREE, exit_code: 0 })
		expect(entry?.tail).toContain(GROWTH_NOTICE)
		expect(written_output()).toContain(entry?.tail)
	})
})
