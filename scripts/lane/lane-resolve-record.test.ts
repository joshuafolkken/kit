import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { git_worktree } from '#scripts/git/git-worktree'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_resolve_record } from './lane-resolve-record'

// joshuafolkken/kit#5922: `josh lane:resolve --record` posts the resolution comment step-back
// condition 3 counts, and only once the concluded merge is on origin.

const ISSUE = '3769'
const LANE = `${ISSUE}-lane`
const HEAD_SHA = 'abc123'
const OLD_SHA = 'def456'
const URL = 'https://github.com/joshuafolkken/kit/issues/3769#issuecomment-1'
const NO_MERGE_PATH = '/nonexistent/.git/MERGE_HEAD'
const PATHS = ['docs/a.md', 'scripts/b.ts']

const branch = vi.spyOn(git_command, 'branch')
const head_commit = vi.spyOn(git_command, 'head_commit')
const ls_remote = vi.spyOn(git_worktree, 'ls_remote_branch')
const git_read = vi.spyOn(git_spawn, 'read')
const issue_comment = vi.spyOn(git_gh_command, 'issue_comment')

async function refusal(): Promise<string> {
	const outcome = await lane_resolve_record.record(ISSUE, PATHS)

	expect(issue_comment).not.toHaveBeenCalled()

	return outcome.kind === 'refused' ? outcome.message : ''
}

beforeEach(() => {
	branch.mockResolvedValue(LANE)
	head_commit.mockResolvedValue(HEAD_SHA)
	ls_remote.mockResolvedValue(`${HEAD_SHA}\trefs/heads/${LANE}`)
	git_read.mockResolvedValue(NO_MERGE_PATH)
	issue_comment.mockResolvedValue(URL)
})

describe('lane_resolve_record.record on a pushed lane', () => {
	it('posts the resolution heading and the paths', async () => {
		await expect(lane_resolve_record.record(ISSUE, PATHS)).resolves.toStrictEqual({
			kind: 'recorded',
			url: URL,
		})
		expect(ls_remote).toHaveBeenCalledWith(LANE)
		expect(issue_comment).toHaveBeenCalledWith(
			ISSUE,
			'## Lane conflict resolved\n\n- `docs/a.md`\n- `scripts/b.ts`',
		)
	})

	it('posts the heading alone when no path is named', async () => {
		await lane_resolve_record.record(ISSUE, [])

		expect(issue_comment).toHaveBeenCalledWith(ISSUE, '## Lane conflict resolved')
	})
})

describe('lane_resolve_record.record refusals', () => {
	it('refuses when HEAD is ahead of origin', async () => {
		ls_remote.mockResolvedValue(`${OLD_SHA}\trefs/heads/${LANE}`)

		await expect(refusal()).resolves.toContain(`HEAD ${HEAD_SHA}, origin ${OLD_SHA}`)
	})

	it('refuses when origin has no lane branch', async () => {
		ls_remote.mockResolvedValue('')

		await expect(refusal()).resolves.toContain('origin absent')
	})

	it('refuses an unconcluded merge sitting on the pushed commit', async () => {
		git_read.mockResolvedValue(import.meta.filename)

		await expect(refusal()).resolves.toContain('not concluded')
	})

	it('refuses on another branch before reading origin', async () => {
		branch.mockResolvedValue('main')

		await expect(refusal()).resolves.toBe(`lane:resolve runs on ${LANE}, not main`)
		expect(ls_remote).not.toHaveBeenCalled()
	})
})
