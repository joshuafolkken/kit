import { git_command } from '#scripts/git/git-command'
import { git_remote_branch, type RemoteAnswer } from '#scripts/git/git-remote-branch'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { release_publish } from './release-publish'

const BRANCH = 'release/v1.2.0'

function given(is_local: boolean, remote_answer: RemoteAnswer): void {
	vi.spyOn(git_command, 'branch_exists').mockResolvedValue(is_local)
	vi.spyOn(git_remote_branch, 'ask').mockResolvedValue(remote_answer)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('release_publish.is_release_branch_taken', () => {
	it('reports the name taken when the branch is already in this checkout', async () => {
		given(true, 'absent')

		expect(await release_publish.is_release_branch_taken(BRANCH)).toBe(true)
	})

	// The regression (joshuafolkken/kit#1641): the remote arm used to match `git branch --remotes`
	// short names, which carry the remote, so an unprefixed pattern matched nothing and this answered
	// false for a branch a previous attempt had pushed.
	it('reports the name taken when only origin still has the branch', async () => {
		given(false, 'present')

		expect(await release_publish.is_release_branch_taken(BRANCH)).toBe(true)
	})

	it('reports the name free when neither this checkout nor origin has the branch', async () => {
		given(false, 'absent')

		expect(await release_publish.is_release_branch_taken(BRANCH)).toBe(false)
	})

	// A question that could not be asked has no answer, so it must not be reported as "free": the
	// run would write the version and commit it before git's own push error said the same thing.
	it('refuses instead of reporting the name free when origin cannot be asked', async () => {
		given(false, 'unreachable')

		await expect(release_publish.is_release_branch_taken(BRANCH)).rejects.toThrow(
			release_publish.unreachable_remote_message(BRANCH),
		)
	})

	it('does not ask origin once the branch is here locally', async () => {
		given(true, 'absent')

		await release_publish.is_release_branch_taken(BRANCH)

		expect(git_remote_branch.ask).not.toHaveBeenCalled()
	})
})

describe('release_publish.unreachable_remote_message', () => {
	it('names the branch and says the version has not been written yet', () => {
		const message = release_publish.unreachable_remote_message(BRANCH)

		expect(message).toContain(BRANCH)
		expect(message).toContain('before writing the version')
	})
})
