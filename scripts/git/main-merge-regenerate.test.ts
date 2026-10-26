import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3922: what `resolve` refuses before it touches anything — a conflict on a path
// the table does not name stays the `conflict` stop. The merge it finishes is pinned against real git
// in `main-merge-regenerate.git.test.ts`.

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('./git-spawn', () => ({ git_spawn: { with_output: vi.fn() } }))

const { execa } = await import('execa')
const { git_spawn } = await import('./git-spawn')
const { main_merge_regenerate } = await import('./main-merge-regenerate')
const { main_merge_budget_conflict } = await import('./main-merge-budget-conflict')

const [GENERATED = ''] = main_merge_regenerate.RESOLVED_FILES.map((entry) => entry.path)
const HAND_WRITTEN = 'scripts/git/main-merge.ts'

describe('refusing a merge regeneration cannot finish', () => {
	it.each([
		['a hand-written file', [HAND_WRITTEN]],
		['a hand-written file beside a generated one', [GENERATED, HAND_WRITTEN]],
		['no file at all', []],
	])('answers false on %s without running a command', async (_label, files) => {
		expect(await main_merge_regenerate.resolve(files)).toBe(false)
		expect(execa).not.toHaveBeenCalled()
		expect(git_spawn.with_output).not.toHaveBeenCalled()
	})
})

describe('the table of regenerated files', () => {
	it('regenerates only files whose header says they are generated', async () => {
		const regenerated = main_merge_regenerate.RESOLVED_FILES.filter((entry) => 'command' in entry)
		const headers = await Promise.all(
			regenerated.map(async (entry) => await readFile(entry.path, 'utf8')),
		)

		for (const header of headers) expect(header).toMatch(/generated/iu)
	})

	// joshuafolkken/kit#4976: the page-ceiling table is resolved by its rewrite rule, not regenerated.
	it('rewrites the page-ceiling table with its ceiling-row rule', () => {
		expect(main_merge_regenerate.RESOLVED_FILES).toContainEqual({
			path: main_merge_budget_conflict.BUDGET_TABLE_PATH,
			rewrite: main_merge_budget_conflict.resolve,
		})
	})
})
