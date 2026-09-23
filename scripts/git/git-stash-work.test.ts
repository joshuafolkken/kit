import { afterEach, describe, expect, it, vi } from 'vitest'
import { git_spawn } from './git-spawn'
import { git_stash } from './git-stash'

// joshuafolkken/kit#2476: the lane-close guard reads a tree's status and pushes what it finds. Kept
// apart from `git-stash.test.ts` because spying on the spawn seam makes this file require isolation,
// while that one stays pure.
describe('git_stash — keeping uncommitted work', () => {
	const DIRECTORY = '/lanes/2476'

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reports changes when the porcelain status lists any path, untracked included', async () => {
		const read = vi.spyOn(git_spawn, 'read').mockResolvedValue('?? new-file.ts')

		expect(await git_stash.has_changes(DIRECTORY)).toBe(true)
		expect(read).toHaveBeenCalledWith(['-C', DIRECTORY, 'status', '--porcelain'])
	})

	it('reports no changes for an empty status', async () => {
		vi.spyOn(git_spawn, 'read').mockResolvedValue('')

		expect(await git_stash.has_changes(DIRECTORY)).toBe(false)
	})

	it('pushes untracked files with the message the pop targets', async () => {
		const read = vi.spyOn(git_spawn, 'read').mockResolvedValue('')
		const message = git_stash.work_message('2476', 'lane close')

		await git_stash.push(message, DIRECTORY)

		expect(message).toBe('2476: uncommitted work at lane close')
		expect(read).toHaveBeenCalledWith(['-C', DIRECTORY, 'stash', 'push', '-u', '-m', message])
	})
})
