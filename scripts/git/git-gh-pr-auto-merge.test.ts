import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { ENABLE_AUTO_MERGE_MUTATION, git_gh_pr_auto_merge } from './git-gh-pr-auto-merge'
import {
	find_request,
	FORK_REPO,
	gh_api_routes,
	PR_BRANCH,
	pr_routes,
	REPO_NAME_PATH,
	request_body,
	rest_pull_page,
} from './git-gh-pr-fixture'
import { forget_pr_numbers } from './git-gh-pr-read'

// joshuafolkken/kit#2497. Auto-merge is what lets a flush pull request land after the flush that
// opened it is gone, and the open listing is what lets the next flush notice one that did not.
vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_command: vi.fn(), exec_gh_api: vi.fn() },
	has_stderr_field: (): boolean => false,
	BODY_FROM_STDIN: '-',
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const GRAPHQL_PATH = 'graphql'
const NODE_ID = 'PR_kwDOabc123'
const OPEN_PULLS_PATH = `${REPO_NAME_PATH}/pulls?per_page=100&state=open`
const FLUSH_PREFIX = 'observations/'
const LANDING_NUMBER = 2479
const STUCK_NUMBER = 2469
const FORK_NUMBER = 2400
const OTHER_NUMBER = 2497
const LANDING_REF = 'observations/2026-09-23-160000'
const STUCK_REF = 'observations/2026-09-23-153650'
const FORK_REF = 'observations/2026-09-23-170000'
const MERGED_AT = '2026-09-24T01:23:45Z'

function listing_row(
	number: number,
	head_reference: string,
	repo?: string,
): Record<string, unknown> {
	const head = { ref: head_reference, repo: { full_name: repo ?? 'joshuafolkken/kit' } }

	return { number, head }
}

function open_pull_routes(): Record<string, string> {
	return {
		[OPEN_PULLS_PATH]: rest_pull_page([
			{ ...listing_row(LANDING_NUMBER, LANDING_REF), auto_merge: { merge_method: 'merge' } },
			listing_row(STUCK_NUMBER, STUCK_REF),
			listing_row(FORK_NUMBER, FORK_REF, FORK_REPO),
			listing_row(OTHER_NUMBER, '2497-lane'),
		]),
	}
}

describe('git_gh_pr_auto_merge.pr_enable_auto_merge', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		forget_pr_numbers()
	})

	it('sends the GraphQL auto-merge mutation addressed by the pull request node id', async () => {
		mocked_api.mockImplementation(
			gh_api_routes(pr_routes({ node_id: NODE_ID }, { [GRAPHQL_PATH]: '{}' })),
		)

		await git_gh_pr_auto_merge.pr_enable_auto_merge(PR_BRANCH)

		const requests = mocked_api.mock.calls.map(([request]) => request)

		expect(request_body(find_request(requests, GRAPHQL_PATH))).toEqual({
			query: ENABLE_AUTO_MERGE_MUTATION,
			variables: { id: NODE_ID },
		})
	})

	it('refuses a pull request that carries no node id rather than sending an empty one', async () => {
		mocked_api.mockImplementation(gh_api_routes(pr_routes()))

		await expect(git_gh_pr_auto_merge.pr_enable_auto_merge(PR_BRANCH)).rejects.toThrow('node_id')
	})
})

describe('git_gh_pr_auto_merge.pr_is_merged', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		forget_pr_numbers()
	})

	it('answers true once the pull request reads back merged', async () => {
		mocked_api.mockImplementation(gh_api_routes(pr_routes({ merged_at: MERGED_AT })))

		await expect(git_gh_pr_auto_merge.pr_is_merged(PR_BRANCH)).resolves.toBe(true)
	})

	it('answers false for a read that failed, so a poll asks again', async () => {
		mocked_api.mockImplementation(gh_api_routes({}))

		await expect(git_gh_pr_auto_merge.pr_is_merged(PR_BRANCH)).resolves.toBe(false)
	})
})

describe('git_gh_pr_auto_merge.pr_list_open_with_head_prefix', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('keeps this repository’s flush branches and reads whether each has auto-merge on', async () => {
		mocked_api.mockImplementation(gh_api_routes(open_pull_routes()))

		const pulls = await git_gh_pr_auto_merge.pr_list_open_with_head_prefix(FLUSH_PREFIX)

		expect(pulls).toEqual([
			{ number: LANDING_NUMBER, head_ref: LANDING_REF, has_auto_merge: true },
			{ number: STUCK_NUMBER, head_ref: STUCK_REF, has_auto_merge: false },
		])
	})

	it('pages through the open listing', async () => {
		mocked_api.mockImplementation(gh_api_routes(open_pull_routes()))

		await git_gh_pr_auto_merge.pr_list_open_with_head_prefix(FLUSH_PREFIX)

		const requests = mocked_api.mock.calls.map(([request]) => request)

		expect(find_request(requests, OPEN_PULLS_PATH).should_paginate).toBe(true)
	})
})
