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

const [GENERATED = ''] = main_merge_regenerate.REGENERATED_FILES.map((entry) => entry.path)
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
	it('names only files whose header says they are generated', async () => {
		const headers = await Promise.all(
			main_merge_regenerate.REGENERATED_FILES.map(
				async (entry) => await readFile(entry.path, 'utf8'),
			),
		)

		for (const header of headers) expect(header).toMatch(/generated/iu)
	})
})
