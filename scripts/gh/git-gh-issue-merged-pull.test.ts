import { describe, expect, it, vi } from 'vitest'
import { git_gh_issue_graphql } from './git-gh-issue-graphql'
import { git_gh_issue_merged_pull } from './git-gh-issue-merged-pull'
import { git_gh_transport } from './git-gh-transport'

const REPOSITORY = vi.hoisted(() => ({ owner: 'joshuafolkken', name: 'kit' }))

vi.mock('./git-gh-transport', () => ({ git_gh_transport: { query: vi.fn() } }))

vi.mock('./git-gh-issue-graphql', () => ({
	git_gh_issue_graphql: { repository_variables_of: vi.fn(() => REPOSITORY) },
}))

// joshuafolkken/kit#7646 — the head branch of the merged pull request closing an issue, read from
// GitHub because the checkout no longer holds it.

const ISSUE = '7646'
const MERGED_HEAD = '7646-lane'
const mocked_query = vi.mocked(git_gh_transport.query)

function answer(...nodes: ReadonlyArray<Record<string, unknown>>): string {
	const references = { closedByPullRequestsReferences: { nodes } }

	return JSON.stringify({ data: { repository: { issue: references } } })
}

function pull(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { merged: true, isCrossRepository: false, headRefName: MERGED_HEAD, ...overrides }
}

describe('git_gh_issue_merged_pull.pr_merged_head_of_issue', () => {
	it('answers the merged pull request’s head branch, asking for the issue by number', async () => {
		mocked_query.mockResolvedValueOnce(answer(pull({ merged: false, headRefName: 'open' }), pull()))

		await expect(git_gh_issue_merged_pull.pr_merged_head_of_issue(ISSUE)).resolves.toBe(MERGED_HEAD)
		expect(mocked_query.mock.lastCall?.[0].variables).toStrictEqual({
			...REPOSITORY,
			number: Number(ISSUE),
		})
	})

	it('passes over a fork’s pull request and an unmerged one', async () => {
		mocked_query.mockResolvedValueOnce(
			answer(pull({ isCrossRepository: true }), pull({ merged: false })),
		)

		await expect(git_gh_issue_merged_pull.pr_merged_head_of_issue(ISSUE)).resolves.toBeUndefined()
	})

	it('answers the latest merge for an issue reopened and closed again', async () => {
		const earlier = pull({ mergedAt: '2026-11-01T00:00:00Z', headRefName: 'first-try' })
		const later = pull({ mergedAt: '2026-11-16T00:00:00Z' })

		mocked_query.mockResolvedValueOnce(answer(earlier, later))

		await expect(git_gh_issue_merged_pull.pr_merged_head_of_issue(ISSUE)).resolves.toBe(MERGED_HEAD)
	})

	it('answers nothing on a REST session or an answer it cannot read', async () => {
		mocked_query.mockResolvedValueOnce(undefined).mockResolvedValueOnce('{"errors":[]}')

		await expect(git_gh_issue_merged_pull.pr_merged_head_of_issue(ISSUE)).resolves.toBeUndefined()
		await expect(git_gh_issue_merged_pull.pr_merged_head_of_issue(ISSUE)).resolves.toBeUndefined()
	})

	it('answers nothing without asking when the checkout names no repository', async () => {
		vi.mocked(git_gh_issue_graphql.repository_variables_of).mockReturnValueOnce(undefined)
		mocked_query.mockClear()

		await expect(git_gh_issue_merged_pull.pr_merged_head_of_issue(ISSUE)).resolves.toBeUndefined()
		expect(mocked_query).not.toHaveBeenCalled()
	})
})
