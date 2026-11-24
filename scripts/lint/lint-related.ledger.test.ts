import { document_checks } from '#scripts/document/document-checks'
import { scoped_green } from '#scripts/gate/scoped-green'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { format_steps } from './format-steps'
import { lint_parallel } from './lint-parallel'
import { lint_related } from './lint-related'

const SOURCE = 'scripts/lint/lint-related.ts'
const TREE = { files: { [SOURCE]: 'fixed' }, base: 'base' }
const FAILED = 1
const GREEN_STAGES = ['fix_ms', 'structural_ms', 'lint_ms', 'documents_ms', 'unused_members_ms']

vi.mock('#scripts/git/git-command', () => ({
	git_command: { repository_root: async (): Promise<string> => process.cwd() },
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: async (): Promise<Array<string>> => [SOURCE] },
}))
vi.mock('./format-steps', () => ({ format_steps: { run_scoped: vi.fn() } }))
vi.mock('./lint-parallel', () => ({
	lint_parallel: {
		run_lint_checks: vi.fn(),
		with_import_cycles: vi.fn(async (lint: Promise<number>) => await lint),
	},
}))
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
vi.mock(import('#scripts/gate/since-green'), async (original) => {
	const { since_green } = await original()

	return { since_green: { ...since_green, read_verdict: async () => ({ fallback: 'no-record' }) } }
})
vi.mock('#scripts/gate/tree-verdict', () => ({
	tree_verdict: { read: vi.fn(), record: vi.fn(), record_path: (): string => 'unused-record' },
}))
vi.mock('#scripts/gate/structural-checks', () => ({
	structural_checks: { run_structural: vi.fn(async () => 0) },
}))
vi.mock('#scripts/document/document-checks', () => ({
	document_checks: { check_files: vi.fn(() => 0) },
}))
vi.mock('#scripts/exports/unused-members-check', () => ({
	unused_members_check: {
		spawn_unused_members: vi.fn(async () => ({ exit_code: 0, output: '' })),
	},
}))
vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: { record_lint_related: vi.fn() },
}))

beforeEach(() => {
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	vi.mocked(scoped_green.read_before).mockResolvedValue(TREE)
	vi.mocked(format_steps.run_scoped).mockResolvedValue(0)
	vi.mocked(lint_parallel.run_lint_checks).mockResolvedValue(0)
})

afterEach(() => {
	vi.mocked(lane_ledger_write.record_lint_related).mockReset()
	vi.mocked(document_checks.check_files).mockClear()
	vi.restoreAllMocks()
})

function written_row(): Record<string, unknown> {
	const { calls } = vi.mocked(lane_ledger_write.record_lint_related).mock

	expect(calls).toHaveLength(1)

	return { ...calls[0]?.[0] }
}

describe('lint_related.run_related_lint — one ledger row per run', () => {
	it('records every stage of a green run, the whole run and its exit code', async () => {
		await expect(lint_related.run_related_lint([SOURCE])).resolves.toBe(0)

		const row = written_row()

		for (const stage of GREEN_STAGES) expect(row[stage], stage).toBeTypeOf('number')
		expect(row).toMatchObject({ exit_code: 0, elapsed_ms: expect.any(Number) as number })
	})

	it('runs the document checks once on a green lint, inside their timed stage', async () => {
		await lint_related.run_related_lint([SOURCE])

		expect(document_checks.check_files).toHaveBeenCalledOnce()
	})

	it('leaves out the stages a red lint did not reach', async () => {
		vi.mocked(lint_parallel.run_lint_checks).mockResolvedValue(FAILED)

		await expect(lint_related.run_related_lint([SOURCE])).resolves.toBe(FAILED)

		const row = written_row()

		expect(row).toMatchObject({ exit_code: FAILED })
		expect(row['lint_ms']).toBeTypeOf('number')
		expect(row).not.toHaveProperty('documents_ms')
	})

	it('times the unused members child even on a red lint, since it starts beside the lint', async () => {
		vi.mocked(lint_parallel.run_lint_checks).mockResolvedValue(FAILED)

		await lint_related.run_related_lint([SOURCE])

		expect(written_row()['unused_members_ms']).toBeTypeOf('number')
	})

	it('keeps the exit code when the ledger write throws', async () => {
		vi.mocked(lint_parallel.run_lint_checks).mockResolvedValue(FAILED)
		vi.mocked(lane_ledger_write.record_lint_related).mockRejectedValue(new Error('disk full'))

		await expect(lint_related.run_related_lint([SOURCE])).resolves.toBe(FAILED)
	})
})
