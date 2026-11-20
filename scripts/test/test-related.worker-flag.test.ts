import type { GateTree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { tree_verdict } from '#scripts/gate/tree-verdict'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_related } from './test-related'
import { test_related_red } from './test-related-red'
import { test_related_reuse } from './test-related-reuse'
import { test_related_run } from './test-related-run'

const SOURCE = 'source.ts'
const WORKER_FLAG = '--maxWorkers=4'
const TREE: GateTree = { files: { [SOURCE]: 'digest' }, base: 'base-commit' }

vi.mock(import('#scripts/git/changed-file-scope'), async (import_original) => {
	const original = await import_original()

	return {
		changed_file_scope: {
			...original.changed_file_scope,
			repository_root_or_cwd: vi.fn(async () => process.cwd()),
			report_unusable_arguments: vi.fn(),
		},
	}
})
vi.mock('#scripts/git/changed-paths')
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
vi.mock('#scripts/gate/tree-verdict', () => ({
	tree_verdict: { read: vi.fn(), record: vi.fn(), record_path: vi.fn(() => 'unused') },
}))
vi.mock('./test-unit-guard', () => ({ test_unit_guard: { is_running: vi.fn(() => true) } }))
vi.mock('./test-read-map')
vi.mock('./test-related-red')
vi.mock('./test-related-reuse')
vi.mock('./test-related-run')

beforeEach(() => {
	vi.mocked(scoped_green.read_before).mockResolvedValue(TREE)
	vi.mocked(test_related_run.run_and_vouch).mockResolvedValue(0)
	vi.mocked(test_related_red.narrowing).mockResolvedValue({
		parts: { changed: [], synced: [] },
		moved: [],
		failed: [],
		owed: [],
	})
})

function vouched_tree(): GateTree | undefined {
	return vi.mocked(test_related_run.run_and_vouch).mock.calls[0]?.[2]
}

describe('test_related.run_related_tests — a worker flag (joshuafolkken/kit#8168)', () => {
	it.each([[[WORKER_FLAG]], [['--max-workers=2']]])(
		'%j still reads the green it can reuse and vouches for the tree',
		async (given) => {
			expect(await test_related.run_related_tests(given)).toBe(0)
			expect(vi.mocked(test_related_reuse.read).mock.calls[0]?.[2]).toBe(TREE)
			expect(vouched_tree()).toBe(TREE)
		},
	)

	it('answers to the same verdict record as the bare run', async () => {
		await test_related.run_related_tests([WORKER_FLAG])
		await test_related.run_related_tests([])

		const [flagged, bare] = vi.mocked(tree_verdict.record_path).mock.calls

		expect(flagged).toEqual(bare)
	})

	it('a narrowing file argument vouches for no tree', async () => {
		expect(await test_related.run_related_tests([SOURCE, WORKER_FLAG])).toBe(0)
		expect(vi.mocked(test_related_reuse.read).mock.calls[0]?.slice(2)).toEqual([
			undefined,
			'scoped-arguments',
		])
		expect(vouched_tree()).toBeUndefined()
	})
})
