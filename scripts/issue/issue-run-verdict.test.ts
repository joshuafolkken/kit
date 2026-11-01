import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_LANE_LABEL, RUN_SOLO_LABEL } from './issue-labels'
import { issue_run_verdict } from './issue-run-verdict'

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_apply_label: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const apply_label = vi.mocked(git_gh_command.issue_apply_label)
const ISSUE = '5636'

beforeEach(() => {
	vi.clearAllMocks()
	apply_label.mockResolvedValue({ is_applied: true })
})

describe('issue_run_verdict.run_label_of', () => {
	it('names run:lane for --lane and run:solo for --solo', () => {
		expect(issue_run_verdict.run_label_of({ lane: true })).toBe(RUN_LANE_LABEL)
		expect(issue_run_verdict.run_label_of({ solo: true })).toBe(RUN_SOLO_LABEL)
	})

	it('answers nothing when neither or both are given', () => {
		expect(issue_run_verdict.run_label_of({})).toBeUndefined()
		expect(issue_run_verdict.run_label_of({ lane: true, solo: true })).toBeUndefined()
	})
})

describe('issue_run_verdict.apply_labels', () => {
	it('applies every label in the order given', async () => {
		expect(await issue_run_verdict.apply_labels(ISSUE, ['a', 'b'])).toBeUndefined()
		expect(apply_label.mock.calls).toStrictEqual([
			[ISSUE, 'a'],
			[ISSUE, 'b'],
		])
	})

	it('stops at the first label that fails and names it', async () => {
		apply_label.mockResolvedValueOnce({ is_applied: false, reason: 'denied' })

		expect(await issue_run_verdict.apply_labels(ISSUE, ['a', 'b'])).toBe(
			'could not apply `a`: denied',
		)
		expect(apply_label).toHaveBeenCalledTimes(1)
	})
})
