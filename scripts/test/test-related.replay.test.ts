import { tree_verdict } from '#scripts/gate/tree-verdict'
import { describe, expect, it, vi } from 'vitest'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_related_run } from './test-related-run'

vi.mock('#scripts/git/changed-file-scope', () => ({
	changed_file_scope: { repository_root_or_cwd: vi.fn(async () => process.cwd()) },
}))
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
vi.mock('#scripts/gate/tree-verdict', () => ({
	tree_verdict: { read: vi.fn(), replay: vi.fn(() => 0), record_path: vi.fn(() => 'unused') },
}))
vi.mock('./test-unit-guard', () => ({ test_unit_guard: { is_running: vi.fn(() => true) } }))
vi.mock('./test-read-map')
vi.mock('./test-related-run')

describe('test_related.run_related_tests — replay integration', () => {
	it.each([[], ['source.ts']])(
		'replays %j before resolving the scope or starting vitest',
		async (...given) => {
			vi.mocked(tree_verdict.read).mockReturnValue({
				tree: 'digest',
				exit_code: 0,
				tail: '',
				at: 'now',
			})

			expect(await test_related.run_related_tests(given)).toBe(0)
			expect(tree_verdict.replay).toHaveBeenCalled()
			expect(test_read_map.read_map).not.toHaveBeenCalled()
			expect(test_related_run.run_and_vouch).not.toHaveBeenCalled()
		},
	)
})
