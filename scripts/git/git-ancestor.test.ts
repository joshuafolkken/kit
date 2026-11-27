import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_ancestor } from './git-ancestor'
import { git_spawn } from './git-spawn'

vi.mock('./git-spawn', () => ({ git_spawn: { read: vi.fn() } }))

// joshuafolkken/kit#9148: the exit-code probes the lane entry and the pre-merge check share.

const read = vi.mocked(git_spawn.read)

beforeEach(() => {
	read.mockReset()
})

describe('git_ancestor.succeeds', () => {
	it('answers true when git exits zero and false when it fails', async () => {
		read.mockResolvedValueOnce('')
		read.mockRejectedValueOnce(new Error('exit 1'))

		await expect(git_ancestor.succeeds(['status'])).resolves.toBe(true)
		await expect(git_ancestor.succeeds(['status'])).resolves.toBe(false)
	})
})

describe('git_ancestor.is_ancestor', () => {
	it('asks merge-base --is-ancestor with the commit first', async () => {
		read.mockResolvedValueOnce('')

		await expect(git_ancestor.is_ancestor('abc1234', 'HEAD')).resolves.toBe(true)
		expect(read).toHaveBeenCalledWith(['merge-base', '--is-ancestor', 'abc1234', 'HEAD'])
	})

	it('answers false for a commit off the history or unknown to git', async () => {
		read.mockRejectedValueOnce(new Error('exit 1'))

		await expect(git_ancestor.is_ancestor('abc1234', 'HEAD')).resolves.toBe(false)
	})
})
