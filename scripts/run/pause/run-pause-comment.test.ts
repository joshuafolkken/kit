import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { afterEach, expect, it, vi } from 'vitest'
import { run_pause_comment } from './run-pause-comment'

afterEach(() => vi.restoreAllMocks())

it('distinguishes absent and malformed comments', async () => {
	vi.spyOn(git_gh_issue_read, 'issue_list_comments')
		.mockResolvedValueOnce('[]')
		.mockResolvedValueOnce('invalid')
	expect(await run_pause_comment.is_paused('10')).toBe(false)
	await expect(run_pause_comment.is_paused('10')).rejects.toThrow('could not be read')
})
