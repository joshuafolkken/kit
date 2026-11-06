import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { git_stash } from '#scripts/git/stash/git-stash'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { lane_close } from './lane-close'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#3772, #5841: the merged-lane close and `run:merge --stash` keep a lane's uncommitted
// work through one writer — one stash message `stash:pop` matches, and one Issue comment naming it. A
// failed push announces nothing and answers `false`, so the caller keeps the tree.

const comment_mock = vi.hoisted(() => vi.fn<(issue: string, body: string) => Promise<void>>())

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_try_comment: comment_mock },
}))

const { lane_preserve } = await import('./lane-preserve')

const ISSUE = '5841'
const OCCASION = 'stopped unit'
const CAUSE = 'the unit stopped'
const LANE_DIRECTORY = make_directory('lane-preserve-')

mkdirSync(path.join(LANE_DIRECTORY, '.git'))

function lane_with_changes(has_changes: boolean): MockInstance<typeof git_stash.push> {
	vi.spyOn(lane_close, 'resolve_lane').mockResolvedValue({
		existing: undefined,
		targets: { directory: LANE_DIRECTORY, branch: `${ISSUE}-lane` },
	})
	vi.spyOn(git_stash, 'has_changes').mockResolvedValue(has_changes)

	return vi.spyOn(git_stash, 'push').mockResolvedValue()
}

describe('lane_preserve.preserve_lane', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		comment_mock.mockReset()
	})

	it('stashes the lane work and comments the cause and the stash:pop line', async () => {
		const push = lane_with_changes(true)

		await expect(lane_preserve.preserve_lane(ISSUE, OCCASION, CAUSE)).resolves.toBe(true)

		const message = git_stash.work_message(ISSUE, OCCASION)
		const [issue, body] = comment_mock.mock.calls[0] ?? []

		expect(push).toHaveBeenCalledWith(message, LANE_DIRECTORY)
		expect(issue).toBe(ISSUE)
		expect(body).toContain(`uncommitted work when ${CAUSE}, so it was stashed`)
		expect(body).toContain(`pnpm josh stash:pop "${message}"`)
	})

	it('leaves a clean lane and the issue untouched', async () => {
		const push = lane_with_changes(false)

		await expect(lane_preserve.preserve_lane(ISSUE, OCCASION, CAUSE)).resolves.toBe(true)
		expect(push).not.toHaveBeenCalled()
		expect(comment_mock).not.toHaveBeenCalled()
	})

	it('reports a failed push, announces nothing and answers false', async () => {
		const push = lane_with_changes(true)
		const error = vi.spyOn(console, 'error').mockReturnValue()

		push.mockRejectedValue(new Error('stash failed'))

		await expect(lane_preserve.preserve_lane(ISSUE, OCCASION, CAUSE)).resolves.toBe(false)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('could not be stashed'))
		expect(comment_mock).not.toHaveBeenCalled()
	})
})

describe('lane_preserve.preserve_lane — a directory with no .git', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		comment_mock.mockReset()
	})

	it('answers true untouched — the remnant of an interrupted close holds nothing git could keep', async () => {
		const push = lane_with_changes(true)
		const directory = make_directory('lane-preserve-bare-')

		vi.spyOn(lane_close, 'resolve_lane').mockResolvedValue({
			existing: undefined,
			targets: { directory, branch: ISSUE },
		})

		await expect(lane_preserve.preserve_lane(ISSUE, OCCASION, CAUSE)).resolves.toBe(true)
		expect(push).not.toHaveBeenCalled()
		expect(comment_mock).not.toHaveBeenCalled()
	})
})
