import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_park } from '#scripts/issue/issue-park'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_seat_fixture } from '#scripts/lane/lane-seat-fixture'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_ending } from '#scripts/run/run-ending'
import { run_label } from '#scripts/run/run-label'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_merge_decision_fixture } from './run-merge-decision-fixture'
import { run_merge_steps } from './run-merge-steps'

const CHILD = '6268'
const NEEDS_DECISION = 'needs-decision'
const CARRY = {
	invocation: 'backlogrun',
	started_at: new Date().toISOString(),
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const CONTEXT = {
	child: CHILD,
	epic: undefined,
	repo: undefined,
	over: true as const,
	owner: run_carry.NO_OWNER,
	output: '/stub/6268.log',
}

beforeEach(() => {
	vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([])
	vi.spyOn(git_gh_command, 'issue_get_body').mockResolvedValue(undefined)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({ kind: 'unreadable' })
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/stub')
	vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry: CARRY })
	vi.spyOn(run_label, 'unmark').mockResolvedValue(true)
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(undefined)
	vi.spyOn(issue_park, 'apply').mockResolvedValue({ is_labelled: true, is_commented: true })
})
beforeEach(lane_seat_fixture.mock_stop)

describe('run_merge_steps — questions park as decisions', () => {
	it.each(run_merge_decision_fixture.MESSAGES)(
		'does not count failure (ac-449e2c86): %s',
		async (message) => {
			vi.spyOn(run_ending, 'read_transcript').mockReturnValue(
				run_merge_decision_fixture.transcript(message),
			)
			const apply = vi.spyOn(run_carry, 'apply_change')

			const result = await run_merge_steps.do_failed(CONTEXT)

			expect(result).toMatchObject({ is_parked: true, cause: NEEDS_DECISION })
			expect(issue_park.apply).toHaveBeenCalledExactlyOnceWith(
				CHILD,
				NEEDS_DECISION,
				expect.stringContaining(message),
			)
			expect(apply).not.toHaveBeenCalled()
		},
	)

	it('refuses an unowned run before changing its labels', async () => {
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(
			run_merge_decision_fixture.transcript('Proceed?'),
		)
		vi.spyOn(run_carry, 'read_carry').mockReturnValue({
			kind: 'carried',
			carry: { ...CARRY, is_handed_off: true },
		})

		expect(await run_merge_steps.do_failed(CONTEXT)).toMatchObject({ is_refused: true })
		expect(issue_park.apply).not.toHaveBeenCalled()
	})
})
