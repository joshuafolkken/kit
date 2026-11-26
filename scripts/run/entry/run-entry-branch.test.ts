import { beforeEach, describe, expect, it, vi } from 'vitest'

const title_mock = vi.hoisted(() => vi.fn())
const create_mock = vi.hoisted(() => vi.fn())
const branch_mock = vi.hoisted(() => vi.fn())
const remote_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_get_title: title_mock },
}))
vi.mock('#scripts/git/git-branch', () => ({
	git_branch: { check_and_create_branch: create_mock },
}))
vi.mock('#scripts/git/git-command', () => ({
	git_command: { branch: branch_mock, branch_names_remote: remote_mock },
}))

const { run_entry_branch } = await import('./run-entry-branch')

const ISSUE = '8983'

beforeEach(() => {
	title_mock.mockReset().mockResolvedValue('Create the issue branch at entry')
	create_mock.mockReset().mockResolvedValue(`${ISSUE}-create-the-issue-branch-at-entry`)
	branch_mock.mockReset().mockResolvedValue('main')
	remote_mock.mockReset().mockResolvedValue([])
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('run_entry_branch.switch_to_issue_branch', () => {
	it('creates the branch `josh git -y` would, from the issue title', async () => {
		await run_entry_branch.switch_to_issue_branch(ISSUE)

		expect(create_mock).toHaveBeenCalledExactlyOnceWith(
			'main',
			`${ISSUE}-create-the-issue-branch-at-entry`,
		)
	})

	it('leaves the branch and warns when the title cannot be read', async () => {
		title_mock.mockResolvedValue(undefined)

		await run_entry_branch.switch_to_issue_branch(ISSUE)

		expect(create_mock).not.toHaveBeenCalled()
		expect(console.warn).toHaveBeenCalledOnce()
	})

	// Round-2 finding: a local branch cut from main would hide the remote's commits from the preflight.
	it('leaves a remote-only issue branch to the preflight instead of cutting a bare one', async () => {
		remote_mock.mockResolvedValue([`origin/${ISSUE}-earlier-work`])

		await run_entry_branch.switch_to_issue_branch(ISSUE)

		expect(remote_mock).toHaveBeenCalledExactlyOnceWith(`*/${ISSUE}-*`)
		expect(create_mock).not.toHaveBeenCalled()
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('a remote branch'))
	})

	it('warns rather than stopping when the branch cannot be created', async () => {
		const failure = 'checkout failed'

		create_mock.mockRejectedValue(new Error(failure))

		await expect(run_entry_branch.switch_to_issue_branch(ISSUE)).resolves.toBeUndefined()
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(failure))
	})
})
