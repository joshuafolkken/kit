import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { main_merge } from '#scripts/git/main-merge'
import { issue_read, type IssueComment } from '#scripts/issue/issue-read'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_resolve } from './lane-resolve'

// joshuafolkken/kit#5837: `josh lane:resolve` answers `resolved`, `conflict <paths>` or
// `step-back 2|3`, and aborts the merge it parks on.

const ISSUE = '3769'
const BASE = 'base-sha'
const OVERLAPPING = 'docs/a.md'
const ADJACENT = 'docs/b.md'
const OURS_DIFF = '@@ -10,3 +10,3 @@'
const THEIRS_OVERLAP = '@@ -12 +12 @@'
const THEIRS_ADJACENT = '@@ -13,2 +13,2 @@'
const REFUSAL = 'dirty tree'

const list_comments = vi.spyOn(git_gh_issue_read, 'issue_list_comments')
const parse_comments = vi.spyOn(issue_read, 'parse_comments')
const merge = vi.spyOn(main_merge, 'merge')
const git_read = vi.spyOn(git_spawn, 'read')
const branch = vi.spyOn(git_command, 'branch')

function comment(body: string, is_trusted: boolean): IssueComment {
	return { author: 'joshuafolkken', created_at: '2026-11-02T00:00:00Z', body, is_trusted }
}

function theirs_diff_of(file: string): string {
	return file === OVERLAPPING ? THEIRS_OVERLAP : THEIRS_ADJACENT
}

async function fake_git(arguments_: Array<string>): Promise<string> {
	if (arguments_[0] === 'merge-base') return BASE
	if (arguments_[0] !== 'diff') return ''

	return arguments_[3] === 'HEAD' ? OURS_DIFF : theirs_diff_of(arguments_.at(-1) ?? '')
}

beforeEach(() => {
	list_comments.mockResolvedValue('[]')
	parse_comments.mockResolvedValue([])
	git_read.mockImplementation(fake_git)
	branch.mockResolvedValue(`${ISSUE}-lane`)
})

describe('lane_resolve.resolve on the branch', () => {
	it('refuses on another branch before any comment read or merge', async () => {
		branch.mockResolvedValue('main')

		await expect(lane_resolve.resolve(ISSUE)).resolves.toStrictEqual({
			kind: 'refused',
			message: `lane:resolve runs on ${ISSUE}-lane, not main`,
		})
		expect(list_comments).not.toHaveBeenCalled()
		expect(merge).not.toHaveBeenCalled()
	})
})

describe('lane_resolve.resolve on the resolution count', () => {
	it('steps back on condition 3 before any merge when a resolution is already recorded', async () => {
		parse_comments.mockResolvedValue([
			comment(`${lane_resolve.RESOLUTION_HEADING}\n\n- \`a\``, true),
		])

		await expect(lane_resolve.resolve(ISSUE)).resolves.toStrictEqual({
			kind: 'step-back',
			condition: 3,
			files: [],
		})
		expect(merge).not.toHaveBeenCalled()
	})

	it('does not count a resolution heading quoted by an untrusted author', async () => {
		parse_comments.mockResolvedValue([comment(lane_resolve.RESOLUTION_HEADING, false)])
		merge.mockResolvedValue({ kind: 'merged', branch: 'main' })

		await expect(lane_resolve.resolve(ISSUE)).resolves.toStrictEqual({ kind: 'resolved' })
	})

	it('refuses when the comment thread cannot be read', async () => {
		parse_comments.mockResolvedValue(undefined)

		await expect(lane_resolve.resolve(ISSUE)).resolves.toMatchObject({ kind: 'refused' })
		expect(merge).not.toHaveBeenCalled()
	})
})

describe('lane_resolve.resolve on a merge', () => {
	it('answers conflict with every path when no hunks overlap, leaving the merge in progress', async () => {
		merge.mockResolvedValue({ kind: 'conflict', files: [ADJACENT] })

		await expect(lane_resolve.resolve(ISSUE)).resolves.toStrictEqual({
			kind: 'conflict',
			files: [ADJACENT],
		})
		expect(git_read).not.toHaveBeenCalledWith(['merge', '--abort'])
	})

	it('steps back on condition 2 naming the overlapping paths, and aborts the merge', async () => {
		merge.mockResolvedValue({ kind: 'conflict', files: [ADJACENT, OVERLAPPING] })

		await expect(lane_resolve.resolve(ISSUE)).resolves.toStrictEqual({
			kind: 'step-back',
			condition: 2,
			files: [OVERLAPPING],
		})
		expect(git_read).toHaveBeenCalledWith(['merge', '--abort'])
	})

	it('passes a refused merge through', async () => {
		merge.mockResolvedValue({ kind: 'refused', message: REFUSAL })

		await expect(lane_resolve.resolve(ISSUE)).resolves.toStrictEqual({
			kind: 'refused',
			message: REFUSAL,
		})
	})
})

describe('lane_resolve.verdict_line', () => {
	it.each([
		[{ kind: 'resolved' } as const, 'resolved'],
		[{ kind: 'conflict', files: ['a', 'b'] } as const, 'conflict a b'],
		[{ kind: 'step-back', condition: 2, files: ['a'] } as const, 'step-back 2 a'],
		[{ kind: 'step-back', condition: 3, files: [] } as const, 'step-back 3'],
	])('prints %o as %s', (outcome, line) => {
		expect(lane_resolve.verdict_line(outcome)).toBe(line)
	})
})
