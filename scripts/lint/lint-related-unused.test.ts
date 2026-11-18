import { unused_members_check } from '#scripts/exports/unused-members-check'
import { scoped_green } from '#scripts/gate/scoped-green'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { format_steps } from './format-steps'
import { lint_parallel } from './lint-parallel'
import { lint_related } from './lint-related'

const SOURCE = 'scripts/lint/lint-related.ts'
const TREE = { files: { [SOURCE]: 'text' }, base: 'base' }
const FAILED = 1
const UNUSED_REPORT = 'josh exports: 1 namespace member(s) nothing reads'

vi.mock('#scripts/git/git-command', () => ({
	git_command: { repository_root: async () => process.cwd() },
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: async () => [SOURCE] },
}))
vi.mock('./format-steps', () => ({ format_steps: { run_scoped: vi.fn(async () => 0) } }))
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
	unused_members_check: { spawn_unused_members: vi.fn() },
}))

afterEach(() => vi.restoreAllMocks())

function run_with(lint_code: number): Promise<number> {
	vi.mocked(scoped_green.read_before).mockResolvedValue(TREE)
	vi.mocked(lint_parallel.run_lint_checks).mockResolvedValue(lint_code)
	vi.mocked(unused_members_check.spawn_unused_members).mockResolvedValue({
		exit_code: FAILED,
		output: UNUSED_REPORT,
	})

	return lint_related.run_related_lint([])
}

// joshuafolkken/kit#7829: the unused member check starts beside the lint, in a child, and is
// reported only once everything before it is green.
describe('lint_related.run_related_lint — the unused member check beside the lint', () => {
	it('starts the check before the lint runs', async () => {
		vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		await run_with(0)

		expect(
			vi.mocked(unused_members_check.spawn_unused_members).mock.invocationCallOrder[0],
		).toBeLessThan(vi.mocked(lint_parallel.run_lint_checks).mock.invocationCallOrder[0] ?? 0)
		expect(vi.mocked(format_steps.run_scoped)).toHaveBeenCalled()
	})

	it('reports its failure and output after a green lint', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		await expect(run_with(0)).resolves.toBe(FAILED)
		expect(write.mock.calls.join('\n')).toContain(UNUSED_REPORT)
		expect(write.mock.calls.join('\n')).toContain('failed: unused members')
	})

	it('names the lint and drops the check’s output when the lint is red', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		await expect(run_with(FAILED)).resolves.toBe(FAILED)
		expect(write.mock.calls.join('\n')).toContain('failed: lint')
		expect(write.mock.calls.join('\n')).not.toContain(UNUSED_REPORT)
	})
})
