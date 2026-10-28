import { describe, expect, it, vi } from 'vitest'

const diff_main_names = vi.fn()
const diff_names_since = vi.fn()
const diff_cached_names = vi.fn()
const untracked_names = vi.fn()
const tree_names_at = vi.fn()
const resolved_through_merge = vi.fn()

vi.mock('./change-base', () => ({
	change_base: {
		resolved_through_merge: async (): Promise<string | undefined> =>
			(await resolved_through_merge()) as string | undefined,
	},
}))
vi.mock('./git-command', () => ({
	git_command: {
		diff_cached_names: async (): Promise<string> => (await diff_cached_names()) as string,
		diff_main_names: async (): Promise<string> => (await diff_main_names()) as string,
		diff_names_since: async (...parameters: Array<unknown>): Promise<string> =>
			(await diff_names_since(...parameters)) as string,
		tree_names_at: async (...parameters: Array<unknown>): Promise<string> =>
			(await tree_names_at(...parameters)) as string,
		untracked_names: async (): Promise<string> => (await untracked_names()) as string,
	},
}))

const { changed_paths } = await import('./changed-paths')

const UNTRACKED = 'new.ts'
const TRACKED = 'tracked.ts'
const LATER_BASE = 'later-base'

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

	// joshuafolkken/kit#5307: through a merge in progress the tree's base is the later one, so the
	// default branch's files the merge brought in are not read as this branch's.
	it('reads the tracked diff from the base through a merge in progress', async () => {
		resolved_through_merge.mockResolvedValueOnce(LATER_BASE)
		diff_names_since.mockResolvedValue(TRACKED)
		untracked_names.mockResolvedValue('')

		await expect(changed_paths.read_changed_paths(false)).resolves.toStrictEqual([TRACKED])
		expect(diff_names_since).toHaveBeenCalledWith(LATER_BASE)
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
