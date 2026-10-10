import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_merged } from './issue-merged'

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))

const exec_gh_api = vi.mocked(git_gh_exec.exec_gh_api)
const MERGED = 'merged-reference\t'
const CLOSED = 'closed\t'
const CLOSED_COMPLETED = 'closed\tcompleted'
const CLOSED_NOT_PLANNED = 'closed\tnot_planned'
const REOPENED = 'reopened\t'
const READ_FAILURE = new Error('rate limited')

function rows(...lines: ReadonlyArray<string>): ReturnType<typeof issue_merged.parse_rows> {
	return issue_merged.parse_rows(lines.join('\n'))
}

beforeEach(() => {
	exec_gh_api.mockReset()
})

// joshuafolkken/kit#2701: a sweep deletes work on this answer, so only a close a merge explains counts.
describe('issue_merged.is_merged_close', () => {
	it.each([
		['closed by a merged pull request', [MERGED, CLOSED]],
		['closed as completed after a merged pull request', [MERGED, CLOSED_COMPLETED]],
		['reopened and closed again after a merge', [MERGED, CLOSED, REOPENED, CLOSED]],
	])('answers true when %s', (_label, lines) => {
		expect(issue_merged.is_merged_close(rows(...lines))).toBe(true)
	})

	it.each([
		['closed as not planned', [MERGED, CLOSED_NOT_PLANNED]],
		['closed as a duplicate', [MERGED, 'closed\tduplicate']],
		['closed with no merged pull request', [CLOSED_COMPLETED]],
		['reopened after the merge', [MERGED, CLOSED, REOPENED]],
		['still open', [MERGED]],
		['never touched', []],
	])('answers false when %s', (_label, lines) => {
		expect(issue_merged.is_merged_close(rows(...lines))).toBe(false)
	})
})

describe('issue_merged.read_merged', () => {
	it('reads the paged timeline of the issue', async () => {
		exec_gh_api.mockResolvedValue([MERGED, CLOSED].join('\n'))

		expect(await issue_merged.read_merged('2606')).toBe(true)
		expect(exec_gh_api).toHaveBeenCalledWith(
			expect.objectContaining({
				path: 'repos/{owner}/{repo}/issues/2606/timeline?per_page=100',
				should_paginate: true,
			}),
		)
	})

	it('answers false when the read fails, so nothing is deleted on doubt', async () => {
		exec_gh_api.mockRejectedValue(READ_FAILURE)

		expect(await issue_merged.read_merged('2606')).toBe(false)
	})
})

describe('issue_merged.read_merge_state', () => {
	it.each([
		['merged', [MERGED, CLOSED], true],
		['not merged', [MERGED, CLOSED_NOT_PLANNED], false],
	])('answers the timeline when it reads, %s', async (_label, lines, expected) => {
		exec_gh_api.mockResolvedValue(lines.join('\n'))

		expect(await issue_merged.read_merge_state('2606')).toBe(expected)
	})

	it('answers nothing when the read fails, so a kept answer is not taken from a failure', async () => {
		exec_gh_api.mockRejectedValue(READ_FAILURE)

		expect(await issue_merged.read_merge_state('2606')).toBeUndefined()
	})
})
