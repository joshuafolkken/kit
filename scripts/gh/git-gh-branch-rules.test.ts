import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FULL_PAGE_QUERY, git_gh_api_path } from './git-gh-api-path'
import { forget_branch_rules, read_required_contexts } from './git-gh-branch-rules'
import { git_gh_exec } from './git-gh-exec'

// joshuafolkken/kit#4351: the merge gate tells an optional check from a required one by the base
// branch's rules, and every gap in reading them keeps the gate strict.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const BRANCH = 'main'
const RULES_PATH = `${git_gh_api_path.branch_rules_api_path(BRANCH)}${FULL_PAGE_QUERY}`
const REQUIRED_RULE = {
	type: 'required_status_checks',
	parameters: {
		required_status_checks: [
			{ context: 'Checks', integration_id: 15_368 },
			{ context: 'SonarQube', integration_id: 15_368 },
		],
	},
}
const DELETION_RULE = { type: 'deletion' }

beforeEach(() => {
	vi.clearAllMocks()
	forget_branch_rules()
})

describe('read_required_contexts', () => {
	it('reads the contexts of the required status checks rule', async () => {
		mocked_api.mockResolvedValue(JSON.stringify([DELETION_RULE, REQUIRED_RULE]))

		await expect(read_required_contexts(BRANCH)).resolves.toStrictEqual(['Checks', 'SonarQube'])
		expect(mocked_api).toHaveBeenCalledWith({ path: RULES_PATH, should_paginate: true })
	})

	it('answers no contexts for a branch with no required status checks rule', async () => {
		mocked_api.mockResolvedValue(JSON.stringify([DELETION_RULE]))

		await expect(read_required_contexts(BRANCH)).resolves.toStrictEqual([])
	})

	it('reads the rules once per branch', async () => {
		mocked_api.mockResolvedValue(JSON.stringify([REQUIRED_RULE]))

		await read_required_contexts(BRANCH)
		await read_required_contexts(BRANCH)

		expect(mocked_api).toHaveBeenCalledTimes(1)
	})

	it('reads nothing when the pull request names no base branch', async () => {
		await expect(read_required_contexts(undefined)).resolves.toStrictEqual([])
		expect(mocked_api).not.toHaveBeenCalled()
	})
})

describe('read_required_contexts — a gap keeps the gate strict', () => {
	it('answers no contexts when the read fails, and asks again next time', async () => {
		mocked_api.mockRejectedValueOnce(new Error('HTTP 403'))
		mocked_api.mockResolvedValueOnce(JSON.stringify([REQUIRED_RULE]))

		await expect(read_required_contexts(BRANCH)).resolves.toStrictEqual([])
		await expect(read_required_contexts(BRANCH)).resolves.toStrictEqual(['Checks', 'SonarQube'])
	})

	it('answers no contexts when the answer is not a listing', async () => {
		mocked_api.mockResolvedValue('{"message":"API rate limit exceeded"}')

		await expect(read_required_contexts(BRANCH)).resolves.toStrictEqual([])
	})
})
