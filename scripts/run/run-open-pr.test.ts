import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_open_pr } from './run-open-pr'

vi.mock('#scripts/gh/git-gh-command')
vi.mock('#scripts/git/git-command')

const ISSUE = '5432'
const BRANCH = '5432-lane'

beforeEach(() => {
	vi.mocked(git_command.branch).mockResolvedValue(BRANCH)
	vi.mocked(git_gh_command.pr_view).mockResolvedValue(JSON.stringify({ state: 'OPEN' }))
})

describe('run_open_pr.is_pending', () => {
	it('reads the existing open pull request of this issue branch', async () => {
		expect(await run_open_pr.is_pending(ISSUE)).toBe(true)
		expect(git_gh_command.pr_view).toHaveBeenCalledWith(BRANCH)
	})

	it('does not resume a pull request belonging to another issue', async () => {
		expect(await run_open_pr.is_pending('5391')).toBe(false)
		expect(git_gh_command.pr_view).not.toHaveBeenCalled()
	})

	it.each(['', '{}', 'invalid', '{"state":"CLOSED"}', '{"state":"MERGED"}'])(
		'keeps ordinary entry when the pull request is absent or not open: %s',
		async (raw) => {
			vi.mocked(git_gh_command.pr_view).mockResolvedValue(raw)

			expect(await run_open_pr.is_pending(ISSUE)).toBe(false)
		},
	)

	it('propagates a failed read instead of claiming a resume', async () => {
		vi.mocked(git_gh_command.pr_view).mockRejectedValue(new Error('unreadable'))

		await expect(run_open_pr.is_pending(ISSUE)).rejects.toThrow('unreadable')
	})
})
