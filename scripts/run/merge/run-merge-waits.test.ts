import { git_gh_command } from '#scripts/gh/git-gh-command'
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
