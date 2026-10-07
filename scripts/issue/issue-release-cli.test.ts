import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { repository_labels } from '#scripts/repo/repository-labels'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_release_cli } from './issue-release-cli'

// joshuafolkken/kit#3360: `josh issue:release <N>` links Issue N to the repository's open release
// Issue as a blocker, filing the release Issue only when none is open. The network is stubbed at the
// namespaces the command calls, so what is asserted is the request — never a real filing.

const HERE = 'joshuafolkken/kit'
const ISSUE_NUMBER = 3360
const OPEN_RELEASE = 3400
const FILED_RELEASE = 3401
const FILED_URL = `https://github.com/${HERE}/issues/${String(FILED_RELEASE)}`
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

const issue_list = vi.spyOn(git_gh_issue_list, 'issue_list')
const exec_gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')
const add_blocked_by = vi.spyOn(git_gh_issue_write, 'issue_add_blocked_by')
const ensure_labels = vi.spyOn(repository_labels, 'ensure_labels')

function listing_of(numbers: ReadonlyArray<number>): { json: string; is_capped: boolean } {
	return { json: JSON.stringify(numbers.map((number) => ({ number }))), is_capped: false }
}

function create_body(): unknown {
	const [request] = exec_gh_api.mock.calls[0] ?? []

	return JSON.parse(request?.body ?? '{}')
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(HERE)
	issue_list.mockResolvedValue(listing_of([]))
	exec_gh_api.mockResolvedValue(FILED_URL)
	add_blocked_by.mockResolvedValue(true)
	ensure_labels.mockReturnValue([])
})

afterEach(() => {
	vi.clearAllMocks()
})

afterAll(() => {
	vi.restoreAllMocks()
})

describe('issue_release_cli.run — no release Issue is open', () => {
	it('files one with the release label and no auto-ok, then records the Issue as its blocker', async () => {
		expect(await issue_release_cli.run([String(ISSUE_NUMBER)])).toBe(SUCCESS_EXIT_CODE)
		expect(issue_list).toHaveBeenCalledWith(
			expect.objectContaining({ label: 'release', repo: HERE }),
		)
		expect(create_body()).toMatchObject({
			title: `Release ${HERE} (next version)`,
			labels: ['release', 'depth:0'],
		})
		expect(add_blocked_by).toHaveBeenCalledWith(String(FILED_RELEASE), String(ISSUE_NUMBER))
	})

	it('fails without linking when the create call fails', async () => {
		exec_gh_api.mockRejectedValue(new Error('HTTP 422'))

		expect(await issue_release_cli.run([String(ISSUE_NUMBER)])).toBe(FAILURE_EXIT_CODE)
		expect(add_blocked_by).not.toHaveBeenCalled()
	})

	it('reports a created release Issue whose number is unreadable, without linking', async () => {
		exec_gh_api.mockResolvedValue('not-a-url')

		expect(await issue_release_cli.run([String(ISSUE_NUMBER)])).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('release number is unreadable')
		expect(add_blocked_by).not.toHaveBeenCalled()
	})
})

describe('issue_release_cli.run — a release Issue is open', () => {
	it('files nothing and records the Issue as a blocker of the open one', async () => {
		issue_list.mockResolvedValue(listing_of([OPEN_RELEASE]))

		expect(await issue_release_cli.run([String(ISSUE_NUMBER)])).toBe(SUCCESS_EXIT_CODE)
		expect(exec_gh_api).not.toHaveBeenCalled()
		expect(add_blocked_by).toHaveBeenCalledWith(String(OPEN_RELEASE), String(ISSUE_NUMBER))
	})

	it('fails when the relation cannot be recorded', async () => {
		issue_list.mockResolvedValue(listing_of([OPEN_RELEASE]))
		add_blocked_by.mockResolvedValue(false)

		expect(await issue_release_cli.run([String(ISSUE_NUMBER)])).toBe(FAILURE_EXIT_CODE)
	})
})

describe('issue_release_cli.run — refusals', () => {
	// A listing that failed may hide an open release Issue, and a second one would split the blockers.
	it('files nothing when the open release Issues cannot be listed', async () => {
		issue_list.mockResolvedValue({ json: undefined, is_capped: false })

		expect(await issue_release_cli.run([String(ISSUE_NUMBER)])).toBe(FAILURE_EXIT_CODE)
		expect(exec_gh_api).not.toHaveBeenCalled()
		expect(add_blocked_by).not.toHaveBeenCalled()
	})

	it.each([[[]], [['abc']], [['1', '2']], [['1', '--repo', HERE]]])(
		'refuses %j with the usage line, reading nothing',
		async (argv) => {
			expect(await issue_release_cli.run(argv)).toBe(FAILURE_EXIT_CODE)
			expect(issue_list).not.toHaveBeenCalled()
		},
	)
})
