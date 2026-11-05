import { backlog_triage_decision } from '#scripts/backlog/backlog-triage-decision'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_LANE_LABEL, RUN_SOLO_LABEL } from './issue-labels'
import { issue_run_verdict } from './issue-run-verdict'

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_apply_label: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const apply_label = vi.mocked(git_gh_command.issue_apply_label)
const ISSUE = '5636'
const YES = 'yes'
const NO = 'no'
const UNKNOWN = 'unknown'
const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

beforeEach(() => {
	apply_label.mockResolvedValue({ is_applied: true })
})

describe('issue_run_verdict.run_label_of', () => {
	it.each([
		[NO, YES, YES, RUN_LANE_LABEL],
		[YES, NO, YES, RUN_LANE_LABEL],
		[YES, YES, NO, RUN_LANE_LABEL],
		[UNKNOWN, YES, YES, 'judge'],
		[YES, UNKNOWN, YES, 'judge'],
		[YES, YES, UNKNOWN, 'judge'],
		[undefined, YES, YES, 'judge'],
		[YES, undefined, YES, 'judge'],
		[YES, YES, undefined, 'judge'],
		['invalid', YES, YES, 'judge'],
	])('refuses %s / %s / %s with verdict %s', (defect, verification, every_run, verdict) => {
		expect(
			issue_run_verdict.run_label_of({ solo: true, defect, verification, 'every-run': every_run }),
		).toBeUndefined()
		expect(error).toHaveBeenCalledWith(expect.stringContaining(`--solo refused: ${verdict}`))
	})
})

describe('issue_run_verdict.run_label_of — valid labels', () => {
	it('uses the existing three-condition decision (ac-260ecfdf)', () => {
		const decide = vi.spyOn(backlog_triage_decision, 'decide')

		issue_run_verdict.run_label_of({
			solo: true,
			defect: 'yes',
			verification: 'yes',
			'every-run': 'yes',
		})

		expect(decide).toHaveBeenCalledWith(['yes', 'yes', 'yes'])
		decide.mockRestore()
	})

	it('names run:lane for --lane and run:solo for --solo', () => {
		expect(issue_run_verdict.run_label_of({ lane: true })).toBe(RUN_LANE_LABEL)
		expect(
			issue_run_verdict.run_label_of({
				solo: true,
				defect: 'yes',
				verification: 'yes',
				'every-run': 'yes',
			}),
		).toBe(RUN_SOLO_LABEL)
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

describe('issue_run_verdict.comment_with_answers', () => {
	it('formats the supplied answers once (ac-ab6606a5)', () => {
		expect(
			issue_run_verdict.comment_with_answers('reason', {
				solo: true,
				defect: YES,
				verification: NO,
				'every-run': UNKNOWN,
			}),
		).toBe('reason\n\nsolo-run answers: defect yes · verification no · every-run unknown')
	})

	it('keeps comments without solo unchanged even when answers are supplied', () => {
		expect(issue_run_verdict.comment_with_answers('reason', { lane: true, defect: YES })).toBe(
			'reason',
		)
	})
})
