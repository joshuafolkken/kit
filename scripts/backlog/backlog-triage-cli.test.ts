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
vi.mock('#scripts/epic/epic-blocked-by', () => ({ epic_blocked_by: { record: vi.fn() } }))
vi.mock('#scripts/run/park/run-park', () => ({ run_park: { clear: vi.fn() } }))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const { git_gh_issue_write } = await import('#scripts/gh/git-gh-issue-write')
const { epic_blocked_by } = await import('#scripts/epic/epic-blocked-by')
const { run_park } = await import('#scripts/run/park/run-park')
const apply_label = vi.mocked(git_gh_command.issue_apply_label)
const post_comment = vi.mocked(git_gh_command.issue_comment)
const clear_label = vi.mocked(git_gh_issue_write.issue_clear_label)
const clear_record = vi.mocked(run_park.clear)
const record_blocked_by = vi.mocked(epic_blocked_by.record)

const ISSUE = '5636'
const BLOCKER = '5647'
const DIRECTORY = '/lane/5636'
const REASON = 'no gate path is named'
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const LANE_ARGV = ['--apply', ISSUE, '--lane', '--reason', REASON]
const CLEAR_ARGV = [...LANE_ARGV, '--clear']
const BLOCKED_BY_FLAG = '--blocked-by'
const BLOCKED_ARGV = ['--apply', ISSUE, BLOCKED_BY_FLAG, BLOCKER, '--reason', REASON]

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
	record_blocked_by.mockImplementation(async (request) => {
		order.push(`blocked-by ${request.prerequisite}`)

		return 'recorded'
	})
})

describe('josh backlog:triage — the arguments', () => {
	it.each([
		['no issue', ['--lane', '--reason', REASON]],
		['no run label and no blocker', ['--apply', ISSUE, '--reason', REASON]],
		['both run labels', ['--apply', ISSUE, '--lane', '--solo', '--reason', REASON]],
		['both run labels beside a blocker', [...BLOCKED_ARGV, '--lane', '--solo']],
		['a blank reason', ['--apply', ISSUE, '--lane', '--reason', ' ']],
		['a non-number issue', ['--apply', 'abc', '--lane', '--reason', REASON]],
		['a non-number blocker', ['--apply', ISSUE, BLOCKED_BY_FLAG, 'abc', '--reason', REASON]],
		[
			'the issue as its own blocker',
			['--apply', ISSUE, BLOCKED_BY_FLAG, ISSUE, '--reason', REASON],
		],
		['an unknown flag', [...LANE_ARGV, '--force']],
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

describe('josh backlog:triage --blocked-by', () => {
	it('names the flag in the usage', () => {
		expect(backlog_triage_cli.USAGE).toContain(`[${BLOCKED_BY_FLAG} <M>]`)
	})

	it('records the relation in place of a run label', async () => {
		expect(await backlog_triage_cli.run(BLOCKED_ARGV, DIRECTORY)).toBe(SUCCESS_EXIT_CODE)
		expect(order).toStrictEqual([`blocked-by ${BLOCKER}`, 'comment'])
		expect(record_blocked_by).toHaveBeenCalledWith({ issue: ISSUE, prerequisite: BLOCKER })
		expect(post_comment.mock.calls[0]?.[1]).toContain(`blocked by #${BLOCKER}`)
	})

	it('records the relation before the comment and the run label when both are given', async () => {
		expect(await backlog_triage_cli.run([...BLOCKED_ARGV, '--solo'], DIRECTORY)).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(order).toStrictEqual([`blocked-by ${BLOCKER}`, 'comment', `label ${RUN_SOLO_LABEL}`])
	})

	it('comments nothing and applies no run label when the relation cannot be recorded', async () => {
		const refusal = 'declaration refused'

		record_blocked_by.mockRejectedValueOnce(new Error(refusal))

		expect(await backlog_triage_cli.run([...BLOCKED_ARGV, '--lane'], DIRECTORY)).toBe(
			FAILURE_EXIT_CODE,
		)
		expect(post_comment).not.toHaveBeenCalled()
		expect(apply_label).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(refusal))
	})
})
