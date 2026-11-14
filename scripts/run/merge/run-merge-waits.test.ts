import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_dispatch_dependency } from '#scripts/lane/lane-dispatch-dependency'
import { run_carry } from '#scripts/run/carry/run-carry'
import { afterEach, expect, it, vi } from 'vitest'
import { run_merge_waits } from './run-merge-waits'

const CONTEXT = {
	child: '7427',
	epic: undefined,
	repo: undefined,
	over: undefined,
	owner: run_carry.NO_OWNER,
}

afterEach(() => vi.restoreAllMocks())

it('keeps an unknown launch confirmation retryable without requiring another successful read', async () => {
	const reason = 'launch dependency confirmation'

	vi.spyOn(lane_dispatch_dependency, 'deferred').mockResolvedValue([reason])
	const read = vi
		.spyOn(git_gh_command, 'issue_blocked_by_references')
		.mockRejectedValue(new Error('offline'))

	expect(await run_merge_waits.read(CONTEXT)).toEqual([reason])
	expect(read).not.toHaveBeenCalled()
})

it.each([{ labels: [] }, { labels: ['not-before'] }])(
	'waits on an unreadable body with labels $labels',
	async ({ labels }) => {
		vi.spyOn(lane_dispatch_dependency, 'deferred').mockResolvedValue([])
		vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([])
		vi.spyOn(git_gh_command, 'issue_get_body').mockResolvedValue(undefined)
		vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
			kind: 'state',
			state: { state: 'OPEN', labels, is_human_review: false },
		})

		expect(await run_merge_waits.read(CONTEXT)).toEqual([
			labels.length > 0 ? 'a start date still ahead (`not-before`)' : 'issue body confirmation',
		])
	},
)

it('does not infer a wait from a readable body without waiting conditions', async () => {
	vi.spyOn(lane_dispatch_dependency, 'deferred').mockResolvedValue([])
	vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([])
	vi.spyOn(git_gh_command, 'issue_get_body').mockResolvedValue('')

	expect(await run_merge_waits.read(CONTEXT)).toEqual([])
})
