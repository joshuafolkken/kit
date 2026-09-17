import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create_spawn_error } from './git-execa-error'

// joshuafolkken/kit#1659: what this pins is the strategy. `git pull` with no `pull.rebase` /
// `pull.ff` aborts on a diverged branch, which is the only branch state worth running this command
// on — so the assertions are about which git commands are asked for, and that none of them is a
// fast-forward-only merge.

vi.mock('./git-command', () => ({
	git_command: {
		fetch_branch: vi.fn(),
		get_default_branch: vi.fn(),
		merge_branch: vi.fn(),
		merge_fast_forward: vi.fn(),
	},
}))

const { git_command } = await import('./git-command')
const { main_merge } = await import('./main-merge')

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NO_ARGUMENTS: ReadonlyArray<string> = []
const WORKERS_FLAG = '--workers=1'

// The error a real failure arrives as. `git_spawn.with_output` discards execa's own error and
// rethrows `create_spawn_error('merge', code)`, so asserting git's conflict wording instead would
// pin a message this command cannot emit.
const MERGE_EXIT_CODE = 1
const MERGE_FAILURE = create_spawn_error('merge', MERGE_EXIT_CODE)

const fetch_branch = vi.mocked(git_command.fetch_branch)
const merge_branch = vi.mocked(git_command.merge_branch)
const merge_fast_forward = vi.mocked(git_command.merge_fast_forward)

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.mocked(git_command.get_default_branch).mockResolvedValue('main')
	fetch_branch.mockResolvedValue('')
	merge_branch.mockResolvedValue()
})

describe('merging the default branch into the current branch', () => {
	it('fetches the default branch and merges it', async () => {
		expect(await main_merge.run(NO_ARGUMENTS)).toBe(SUCCESS_EXIT_CODE)
		expect(fetch_branch).toHaveBeenCalledWith('main')
		expect(merge_branch).toHaveBeenCalledWith('main')
	})

	// The regression: a fast-forward-only merge fails on a diverged branch exactly as `git pull` did.
	it('never asks for a fast-forward-only merge', async () => {
		await main_merge.run(NO_ARGUMENTS)

		expect(merge_fast_forward).not.toHaveBeenCalled()
	})

	it('follows the repository default branch rather than assuming main', async () => {
		vi.mocked(git_command.get_default_branch).mockResolvedValue('develop')

		await main_merge.run(NO_ARGUMENTS)

		expect(fetch_branch).toHaveBeenCalledWith('develop')
		expect(merge_branch).toHaveBeenCalledWith('develop')
	})

	it('reports a git failure as a message rather than throwing', async () => {
		merge_branch.mockRejectedValue(MERGE_FAILURE)

		expect(await main_merge.run(NO_ARGUMENTS)).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(MERGE_FAILURE.message)
	})
})

describe('refusing extra arguments', () => {
	it('keeps the message the composite form printed, and runs nothing', async () => {
		expect(await main_merge.run([WORKERS_FLAG])).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('josh main:merge takes no extra arguments'),
		)
	})

	// Ordered before the default-branch read, so the usage error does not depend on git answering.
	it('refuses without asking git anything', async () => {
		await main_merge.run([WORKERS_FLAG])

		expect(fetch_branch).not.toHaveBeenCalled()
		expect(merge_branch).not.toHaveBeenCalled()
	})
})
