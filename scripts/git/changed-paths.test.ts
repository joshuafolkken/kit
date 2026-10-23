import { describe, expect, it, vi } from 'vitest'

const diff_main_names = vi.fn()
const diff_cached_names = vi.fn()
const untracked_names = vi.fn()
const tree_names_at = vi.fn()

vi.mock('./git-command', () => ({
	git_command: {
		diff_cached_names: async (): Promise<string> => (await diff_cached_names()) as string,
		diff_main_names: async (): Promise<string> => (await diff_main_names()) as string,
		tree_names_at: async (...parameters: Array<unknown>): Promise<string> =>
			(await tree_names_at(...parameters)) as string,
		untracked_names: async (): Promise<string> => (await untracked_names()) as string,
	},
}))

const { changed_paths } = await import('./changed-paths')

const UNTRACKED = 'new.ts'
const TRACKED = 'tracked.ts'

describe('changed_paths.to_paths', () => {
	it('drops blank lines and surrounding whitespace', () => {
		expect(changed_paths.to_paths('a.ts\n\n  b.ts  \n')).toStrictEqual(['a.ts', 'b.ts'])
	})

	it('reads an empty listing as no paths', () => {
		expect(changed_paths.to_paths('')).toStrictEqual([])
	})
})

describe('changed_paths.read_changed_paths', () => {
	// `git diff` lists no untracked file, so a change that adds a whole new module would otherwise
	// look like an empty diff to every path-driven decision.
	it('adds the untracked files to the branch diff', async () => {
		diff_main_names.mockResolvedValue(TRACKED)
		untracked_names.mockResolvedValue(UNTRACKED)

		await expect(changed_paths.read_changed_paths(false)).resolves.toStrictEqual([
			TRACKED,
			UNTRACKED,
		])
	})

	// A file staged for addition is already in the cached diff, so the staged form must not add them
	// a second time.
	it('reads the cached diff alone when staged', async () => {
		diff_cached_names.mockResolvedValue('staged.ts')
		untracked_names.mockResolvedValue(UNTRACKED)

		await expect(changed_paths.read_changed_paths(true)).resolves.toStrictEqual(['staged.ts'])
	})
})

describe('changed_paths.read_held_at', () => {
	it('reads which of the paths the commit’s tree held', async () => {
		tree_names_at.mockResolvedValue(`${TRACKED}\n`)

		await expect(changed_paths.read_held_at('abc', [TRACKED, UNTRACKED])).resolves.toStrictEqual([
			TRACKED,
		])
		expect(tree_names_at).toHaveBeenCalledWith('abc', [TRACKED, UNTRACKED])
	})

	// `ls-tree` with no path lists the whole tree, which would hold every file.
	it('asks git nothing for no paths', async () => {
		tree_names_at.mockClear()

		await expect(changed_paths.read_held_at('abc', [])).resolves.toStrictEqual([])
		expect(tree_names_at).not.toHaveBeenCalled()
	})
})
