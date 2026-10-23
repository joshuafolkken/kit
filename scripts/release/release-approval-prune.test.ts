import { git_spawn } from '#scripts/git/git-spawn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { release_approval_prune } from './release-approval-prune'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('release_approval_prune.prune', () => {
	it('removes the approval directory from the index, tolerating its absence', async () => {
		const read = vi.spyOn(git_spawn, 'read').mockResolvedValue('')

		await release_approval_prune.prune()

		expect(read).toHaveBeenCalledWith([
			'rm',
			'-r',
			'-q',
			'--ignore-unmatch',
			'--',
			release_approval_prune.APPROVAL_DIRECTORY,
		])
	})
})
