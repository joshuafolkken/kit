import { NEEDS_DECISION_LABEL, RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_triage_cli } from './backlog-triage-cli'

const { order } = vi.hoisted(() => ({ order: [] as Array<string> }))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_apply_label: vi.fn(), issue_comment: vi.fn() },
}))
vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_clear_label: vi.fn() },
}))
vi.mock('#scripts/run/park/run-park', () => ({ run_park: { clear: vi.fn() } }))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const { git_gh_issue_write } = await import('#scripts/gh/git-gh-issue-write')
const { run_park } = await import('#scripts/run/park/run-park')
const apply_label = vi.mocked(git_gh_command.issue_apply_label)
const post_comment = vi.mocked(git_gh_command.issue_comment)
const clear_label = vi.mocked(git_gh_issue_write.issue_clear_label)
const clear_record = vi.mocked(run_park.clear)

const ISSUE = '5636'
const DIRECTORY = '/lane/5636'
const REASON = 'no gate path is named'
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const LANE_ARGV = ['--apply', ISSUE, '--lane', '--reason', REASON]
const CLEAR_ARGV = [...LANE_ARGV, '--clear']

vi.spyOn(console, 'info').mockImplementation(() => undefined)
vi.spyOn(console, 'error').mockImplementation(() => undefined)

beforeEach(() => {
	vi.clearAllMocks()
	order.length = 0
	clear_record.mockImplementation(() => {
		order.push('record')
	})
	clear_label.mockImplementation(async (_issue, label) => {
		order.push(`clear ${label}`)

		return true
	})
	post_comment.mockImplementation(async () => {
		order.push('comment')

		return ''
	})
	apply_label.mockImplementation(async (_issue, label) => {
		order.push(`label ${label}`)

		return { is_applied: true }
	})
})

describe('josh backlog:triage — the arguments', () => {
	it.each([
		['no issue', ['--lane', '--reason', REASON]],
		['no run label', ['--apply', ISSUE, '--reason', REASON]],
		['both run labels', ['--apply', ISSUE, '--lane', '--solo', '--reason', REASON]],
		['a blank reason', ['--apply', ISSUE, '--lane', '--reason', ' ']],
		['a non-number issue', ['--apply', 'abc', '--lane', '--reason', REASON]],
		['an unknown flag', [...LANE_ARGV, '--blocked-by', '1']],
	])('refuses %s with the usage and writes nothing', async (_case, argv) => {
		expect(await backlog_triage_cli.run(argv, DIRECTORY)).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(backlog_triage_cli.USAGE)
		expect(order).toStrictEqual([])
	})
})

describe('josh backlog:triage --apply', () => {
	it('on --clear clears the park, comments the reason, then applies the run label', async () => {
		expect(await backlog_triage_cli.run(CLEAR_ARGV, DIRECTORY)).toBe(SUCCESS_EXIT_CODE)
		expect(order).toStrictEqual([
			'record',
			`clear ${NEEDS_DECISION_LABEL}`,
			'comment',
			`label ${RUN_LANE_LABEL}`,
		])
		expect(clear_record).toHaveBeenCalledWith(ISSUE, DIRECTORY)
		expect(post_comment.mock.calls[0]?.[1]).toContain(REASON)
	})

	it('leaves the park alone without --clear', async () => {
		expect(await backlog_triage_cli.run(LANE_ARGV, DIRECTORY)).toBe(SUCCESS_EXIT_CODE)
		expect(order).toStrictEqual(['comment', `label ${RUN_LANE_LABEL}`])
	})

	it('applies run:solo for --solo', async () => {
		await backlog_triage_cli.run(['--apply', ISSUE, '--solo', '--reason', REASON], DIRECTORY)

		expect(apply_label).toHaveBeenCalledWith(ISSUE, RUN_SOLO_LABEL)
	})

	it('stops before the comment when the park cannot be cleared', async () => {
		clear_label.mockResolvedValueOnce(false)

		expect(await backlog_triage_cli.run(CLEAR_ARGV, DIRECTORY)).toBe(FAILURE_EXIT_CODE)
		expect(post_comment).not.toHaveBeenCalled()
	})

	it('applies no label when the reason cannot be commented', async () => {
		post_comment.mockRejectedValueOnce(new Error('offline'))

		expect(await backlog_triage_cli.run(LANE_ARGV, DIRECTORY)).toBe(FAILURE_EXIT_CODE)
		expect(apply_label).not.toHaveBeenCalled()
	})

	it('fails when the run label cannot be applied', async () => {
		apply_label.mockResolvedValueOnce({ is_applied: false, reason: 'denied' })

		expect(await backlog_triage_cli.run(LANE_ARGV, DIRECTORY)).toBe(FAILURE_EXIT_CODE)
	})
})
