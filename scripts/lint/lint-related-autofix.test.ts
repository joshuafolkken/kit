import { document_checks } from '#scripts/document/document-checks'
import { scoped_green } from '#scripts/gate/scoped-green'
import { structural_checks } from '#scripts/gate/structural-checks'
import { tree_verdict } from '#scripts/gate/tree-verdict'
import { review_stamps } from '#scripts/review/review-stamps'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { format_steps } from './format-steps'
import { lint_parallel } from './lint-parallel'
import { lint_related } from './lint-related'

const SOURCE = 'scripts/lint/lint-related.ts'
const BEFORE = { files: { [SOURCE]: 'unfixed' }, base: 'base' }
const AFTER = { files: { [SOURCE]: 'fixed' }, base: 'base' }

vi.mock('#scripts/git/git-command', () => ({
	git_command: { repository_root: async () => process.cwd() },
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: async () => [SOURCE] },
}))
vi.mock('./format-steps', () => ({ format_steps: { run_scoped: vi.fn() } }))
vi.mock('./lint-parallel', () => ({ lint_parallel: { run_lint_checks: vi.fn() } }))
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
vi.mock(import('#scripts/gate/since-green'), async (original) => {
	const { since_green } = await original()

	return { since_green: { ...since_green, read_verdict: async () => ({ fallback: 'no-record' }) } }
})
vi.mock('#scripts/gate/tree-verdict', () => ({
	tree_verdict: { read: vi.fn(), record: vi.fn(), record_path: () => 'unused-record' },
}))
vi.mock('#scripts/gate/structural-checks', () => ({
	structural_checks: { run_structural: vi.fn(async () => 0) },
}))
vi.mock('#scripts/document/document-checks', () => ({
	document_checks: { check_files: vi.fn(() => 0) },
}))
vi.mock('#scripts/exports/unused-members-check', () => ({
	unused_members_check: { run_unused_members: async () => 0 },
}))
vi.mock('#scripts/gate/metrics-totals', () => ({
	metrics_totals: { growth_notice: async () => undefined },
}))

afterEach(() => vi.restoreAllMocks())

describe('lint_related autofix verification boundary', () => {
	it.each([
		[0, 0],
		[1, 1],
		[1, 0],
	])('records the verified post-fix verdict %s/%s (ac-0986ec74)', async (fix_code, code) => {
		vi.spyOn(process.stdout, 'write').mockReturnValue(true)
		vi.mocked(scoped_green.read_before).mockResolvedValueOnce(BEFORE).mockResolvedValueOnce(AFTER)
		vi.mocked(format_steps.run_scoped).mockResolvedValue(fix_code)
		vi.mocked(lint_parallel.run_lint_checks).mockResolvedValue(code)

		expect(await lint_related.run_related_lint([])).toBe(code)
		expect(scoped_green.record_if_green).toHaveBeenCalledWith(
			review_stamps.lint_related_stamp,
			expect.objectContaining({ before: AFTER, exit_code: code }),
		)
		expect(tree_verdict.record).toHaveBeenCalledWith(
			expect.objectContaining({ before: AFTER, exit_code: code }),
			expect.any(Function),
			expect.any(String),
		)
		expect(vi.mocked(format_steps.run_scoped).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(structural_checks.run_structural).mock.invocationCallOrder[0] ?? 0,
		)
		if (code === 0) expect(document_checks.check_files).toHaveBeenCalled()
	})
})
