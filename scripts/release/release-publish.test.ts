import { git_command } from '#scripts/git/git-command'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { git_pr_checks } from '#scripts/git/git-pr-checks'
import { git_remote_branch, type RemoteAnswer } from '#scripts/git/git-remote-branch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReleasePlan } from './release-plan'
import { release_publish } from './release-publish'
import { release_tag } from './release-tag'
import { release_worktree } from './release-worktree'

vi.mock('./release-worktree', () => ({
	release_worktree: { create: vi.fn(), remove: vi.fn() },
}))

vi.mock('#scripts/version/bump-version', () => ({ write_version: vi.fn() }))

const BRANCH = 'release/v1.2.0'
const WORKTREE_DIR = '/repo/.kit-lanes/release'
const THREE = 3
const PUBLISH_PLAN: ReleasePlan = {
	base: 'abcdef',
	pending: THREE,
	current_version: '1.1.0',
	next_version: '1.2.0',
}
const PR_SNAPSHOT = { rollup: [], merge_state_status: undefined, review_decision: undefined }

function given(is_local: boolean, remote_answer: RemoteAnswer): void {
	vi.spyOn(git_command, 'branch_exists').mockResolvedValue(is_local)
	vi.spyOn(git_remote_branch, 'ask').mockResolvedValue(remote_answer)
}

function arrange_worktree(): void {
	given(false, 'absent')
	vi.mocked(release_worktree.create).mockResolvedValue(WORKTREE_DIR)
	vi.mocked(release_worktree.remove).mockResolvedValue(undefined)
	vi.spyOn(process, 'chdir').mockImplementation(() => undefined)
}

function arrange_commit(): void {
	vi.spyOn(git_command, 'add_path').mockResolvedValue(undefined)
	vi.spyOn(git_command, 'commit').mockResolvedValue(undefined)
	vi.spyOn(git_command, 'push').mockResolvedValue(undefined)
	vi.spyOn(git_gh_command, 'pr_create').mockResolvedValue('created')
}

function arrange_merge(): void {
	vi.spyOn(git_gh_command, 'pr_merge').mockResolvedValue(undefined)
	vi.spyOn(git_pr_checks, 'wait_for_pr_success').mockResolvedValue(PR_SNAPSHOT)
	vi.spyOn(release_tag, 'wait_for_tag').mockResolvedValue(true)
	vi.spyOn(release_tag, 'format_result').mockReturnValue('tagged')
}

function arrange_publish(): void {
	arrange_worktree()
	arrange_commit()
	arrange_merge()
}

beforeEach(() => {
	vi.clearAllMocks()
})

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

describe('release_publish.publish', () => {
	// The whole release happens in a work tree cut for it, and it is removed on the way out — so a
	// successful release leaves no work tree and no local release branch behind (joshuafolkken/kit#2411).
	it('removes the work tree and its branch after a successful release', async () => {
		arrange_publish()

		const code = await release_publish.publish(PUBLISH_PLAN)

		expect(code).toBe(release_publish.SUCCESS_EXIT_CODE)
		expect(release_worktree.remove).toHaveBeenCalledTimes(1)
		expect(release_worktree.remove).toHaveBeenCalledWith(WORKTREE_DIR, BRANCH)
	})

	// The teardown is in a `finally`, so a failed CI wait cleans the work tree up rather than leaving
	// it parked — the regression this issue's design turns on (joshuafolkken/kit#2411).
	it('removes the work tree even when the CI wait fails', async () => {
		arrange_publish()
		vi.spyOn(git_pr_checks, 'wait_for_pr_success').mockRejectedValue(new Error('ci failed'))

		await expect(release_publish.publish(PUBLISH_PLAN)).rejects.toThrow('ci failed')
		expect(release_worktree.remove).toHaveBeenCalledTimes(1)
		expect(release_worktree.remove).toHaveBeenCalledWith(WORKTREE_DIR, BRANCH)
	})
})

describe('release_publish.unreachable_remote_message', () => {
	it('names the branch and says the version has not been written yet', () => {
		const message = release_publish.unreachable_remote_message(BRANCH)

		expect(message).toContain(BRANCH)
		expect(message).toContain('before writing the version')
	})
})
