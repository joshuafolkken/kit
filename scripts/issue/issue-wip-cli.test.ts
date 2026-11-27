import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_wip_cli } from './issue-wip-cli'

const { resolve_commit, rewrite_row } = vi.hoisted(() => ({
	resolve_commit: vi.fn<(reference: string) => Promise<string | undefined>>(),
	rewrite_row:
		vi.fn<(issue: string, row: { branch: string; sha: string }) => Promise<string | undefined>>(),
}))

vi.mock('#scripts/run/handoff/run-handoff-wip', () => ({
	run_handoff_wip: { resolve_commit, rewrite_row },
}))

const ISSUE = '9153'
const SHA = 'abc1234def'
const BRANCH = 'wip/review-fix'
const SUCCESS = 0
const FAILURE = 1

describe('issue_wip_cli.run', () => {
	beforeEach(() => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		resolve_commit.mockResolvedValue(SHA)
		rewrite_row.mockResolvedValue(undefined)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.resetAllMocks()
	})

	it('rewrites the row to the sha the wip branch names, the wip/ prefix optional', async () => {
		await expect(issue_wip_cli.run([ISSUE, '--wip', 'review-fix'])).resolves.toBe(SUCCESS)

		expect(resolve_commit).toHaveBeenCalledWith(BRANCH)
		expect(rewrite_row).toHaveBeenCalledWith(ISSUE, { branch: BRANCH, sha: SHA })
	})

	it('refuses a branch naming no commit without touching the body', async () => {
		resolve_commit.mockResolvedValue(undefined)

		await expect(issue_wip_cli.run([ISSUE, '--wip', BRANCH])).resolves.toBe(FAILURE)

		expect(rewrite_row).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`no branch ${BRANCH}`))
	})

	it('fails with the problem the row write reports', async () => {
		const problem = 'more than one row'

		rewrite_row.mockResolvedValue(problem)

		await expect(issue_wip_cli.run([ISSUE, '--wip', BRANCH])).resolves.toBe(FAILURE)

		expect(console.error).toHaveBeenCalledWith(problem)
	})

	it('prints the usage without an issue or --wip', async () => {
		await expect(issue_wip_cli.run(['--wip', BRANCH])).resolves.toBe(FAILURE)
		await expect(issue_wip_cli.run([ISSUE])).resolves.toBe(FAILURE)

		expect(resolve_commit).not.toHaveBeenCalled()
	})
})
