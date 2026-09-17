import { describe, expect, it } from 'vitest'
import { git_command } from './git-command'
import { git_common_directory } from './git-common-directory'

const COMMON_DIRECTORY = '/projects/kit with spaces/.git'
const WORKTREE_DIRECTORY = `${COMMON_DIRECTORY}/worktrees/2082`

describe('linked worktree Git common directory', () => {
	it('resolves the current checkout through Git itself', async () => {
		const [own, common] = await git_command.git_directories()
		const expected = own === common ? undefined : common

		expect(git_common_directory.resolve(process.cwd())).toBe(expected)
	})

	it('selects only the common directory of a linked worktree', () => {
		expect(git_common_directory.select_linked([WORKTREE_DIRECTORY, COMMON_DIRECTORY])).toBe(
			COMMON_DIRECTORY,
		)
	})

	it('adds no writable root for a primary worktree', () => {
		expect(git_common_directory.select_linked([COMMON_DIRECTORY, COMMON_DIRECTORY])).toBeUndefined()
	})

	it('refuses an incomplete Git answer', () => {
		expect(git_common_directory.select_linked([WORKTREE_DIRECTORY])).toBeUndefined()
	})
})
