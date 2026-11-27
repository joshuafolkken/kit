import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_wip_cli } from './issue-wip-cli'

type AdoptRead = { kind: 'none' } | { kind: 'row'; row: { branch: string; sha: string } }

const { resolve_commit, rewrite_row, read_issue, is_ancestor } = vi.hoisted(() => ({
	resolve_commit: vi.fn<(reference: string) => Promise<string | undefined>>(),
	rewrite_row:
		vi.fn<(issue: string, row: { branch: string; sha: string }) => Promise<string | undefined>>(),
	read_issue: vi.fn<(issue: string) => Promise<AdoptRead>>(),
	is_ancestor: vi.fn<(sha: string, of: string) => Promise<boolean>>(),
}))

vi.mock('#scripts/run/handoff/run-handoff-wip', () => ({
	run_handoff_wip: { resolve_commit, rewrite_row },
}))
vi.mock('#scripts/issue/issue-body-adopt-branch', () => ({
	issue_body_adopt_branch: { read_issue },
}))
vi.mock('#scripts/git/git-ancestor', () => ({ git_ancestor: { is_ancestor } }))

const ISSUE = '9153'
const SHA = 'abc1234def'
const OLD_SHA = 'fff9999'
const BRANCH = 'wip/review-fix'
const SUCCESS = 0
const FAILURE = 1

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	resolve_commit.mockResolvedValue(SHA)
	rewrite_row.mockResolvedValue(undefined)
	read_issue.mockResolvedValue({ kind: 'none' })
	is_ancestor.mockResolvedValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.resetAllMocks()
})

describe('issue_wip_cli.run on a body naming a row', () => {
	it('warns and still rewrites when the present row is not an ancestor of the new sha', async () => {
		read_issue.mockResolvedValue({ kind: 'row', row: { branch: BRANCH, sha: OLD_SHA } })
		is_ancestor.mockResolvedValue(false)

		await expect(issue_wip_cli.run([ISSUE, '--wip', BRANCH])).resolves.toBe(SUCCESS)

		expect(is_ancestor).toHaveBeenCalledWith(OLD_SHA, SHA)
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining(`${OLD_SHA} is not an ancestor`),
		)
		expect(rewrite_row).toHaveBeenCalledWith(ISSUE, { branch: BRANCH, sha: SHA })
	})

	it('rewrites without a warning when the new sha builds on the present row', async () => {
		read_issue.mockResolvedValue({ kind: 'row', row: { branch: BRANCH, sha: OLD_SHA } })

		await expect(issue_wip_cli.run([ISSUE, '--wip', BRANCH])).resolves.toBe(SUCCESS)

		expect(console.warn).not.toHaveBeenCalled()
		expect(rewrite_row).toHaveBeenCalledWith(ISSUE, { branch: BRANCH, sha: SHA })
	})
})

describe('issue_wip_cli.run', () => {
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
