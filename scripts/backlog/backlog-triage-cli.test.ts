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
vi.mock('./backlog-triage-unblock', () => ({ backlog_triage_unblock: { remove: vi.fn() } }))

const { backlog_triage_unblock } = await import('./backlog-triage-unblock')
const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const { git_gh_issue_write } = await import('#scripts/gh/git-gh-issue-write')
const { epic_blocked_by } = await import('#scripts/epic/epic-blocked-by')
const { run_park } = await import('#scripts/run/park/run-park')
const apply_label = vi.mocked(git_gh_command.issue_apply_label)
const post_comment = vi.mocked(git_gh_command.issue_comment)
const clear_label = vi.mocked(git_gh_issue_write.issue_clear_label)
const clear_record = vi.mocked(run_park.clear)
const record_blocked_by = vi.mocked(epic_blocked_by.record)
const remove_blocked_by = vi.mocked(backlog_triage_unblock.remove)

const ISSUE = '5636'
const BLOCKER = '5647'
const DIRECTORY = '/lane/5636'
const REASON = 'no gate path is named'
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const ARGV_OFFSET = 2
const LANE_ARGV = ['--apply', ISSUE, '--lane', '--reason', REASON]
const CLEAR_ARGV = [...LANE_ARGV, '--clear']
const BLOCKED_BY_FLAG = '--blocked-by'
const BLOCKED_ARGV = ['--apply', ISSUE, BLOCKED_BY_FLAG, BLOCKER, '--reason', REASON]
const UNBLOCK_FLAG = '--unblock'
const UNBLOCK_ARGV = ['--apply', ISSUE, UNBLOCK_FLAG, BLOCKER, '--reason', REASON]
const VERIFICATION_FLAG = '--verification'
const EVERY_RUN_FLAG = '--every-run'
const SOLO_ANSWERS = ['--defect', 'yes', VERIFICATION_FLAG, 'yes', EVERY_RUN_FLAG, 'yes']

vi.spyOn(console, 'info').mockImplementation(() => undefined)
vi.spyOn(console, 'error').mockImplementation(() => undefined)

beforeEach(() => {
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
	remove_blocked_by.mockImplementation(async (request) => {
		order.push(`unblock ${request.prerequisite}`)
	})
})

describe('josh backlog:triage — atomic solo refusal', () => {
	it.each([
		[BLOCKED_BY_FLAG, ''],
		[BLOCKED_BY_FLAG, 'no'],
		[BLOCKED_BY_FLAG, 'unknown'],
		[BLOCKED_BY_FLAG, 'invalid'],
		[UNBLOCK_FLAG, ''],
		[UNBLOCK_FLAG, 'no'],
		[UNBLOCK_FLAG, 'unknown'],
		[UNBLOCK_FLAG, 'invalid'],
	])(
		'refuses invalid solo evidence with %s and clear before every side effect (ac-614b1740)',
		async (relation, answer) => {
			const answers = answer === '' ? [] : ['--defect', answer, ...SOLO_ANSWERS.slice(ARGV_OFFSET)]
			const args = [...BLOCKED_ARGV.slice(0, ARGV_OFFSET), relation, BLOCKER, '--solo', '--clear']

			expect(
				await backlog_triage_cli.run([...args, ...answers, '--reason', REASON], DIRECTORY),
			).toBe(FAILURE_EXIT_CODE)
			expect(order).toStrictEqual([])
		},
	)

	it('shows the three affirmative answers required for solo (ac-facb5348)', () => {
		expect(backlog_triage_cli.USAGE).toContain(`--solo ${SOLO_ANSWERS.join(' ')}`)
	})

	it("shows --done beside --adopt for an option needing the parent's action (joshuafolkken/kit#7001)", () => {
		expect(backlog_triage_cli.USAGE).toContain('--adopt <k> --reason <text> [--done <text>]')
	})
})

describe('josh backlog:triage — the arguments', () => {
	it.each(['no', 'unknown', 'invalid', ''])(
		'refuses solo evidence %s before writing (ac-237df449)',
		async (answer) => {
			const answers =
				answer === '' ? [] : ['--defect', answer, VERIFICATION_FLAG, 'yes', EVERY_RUN_FLAG, 'yes']
			const args = ['--apply', ISSUE, '--solo', ...answers, '--reason', REASON]

			expect(await backlog_triage_cli.run(args, DIRECTORY)).toBe(FAILURE_EXIT_CODE)
			expect(order).toStrictEqual([])
		},
	)

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
		['--blocked-by beside --unblock', [...BLOCKED_ARGV, UNBLOCK_FLAG, '5700']],
		[
			'the issue unblocked from itself',
			['--apply', ISSUE, UNBLOCK_FLAG, ISSUE, '--reason', REASON],
		],
	])('refuses %s with the usage and writes nothing', async (_case, argv) => {
		expect(await backlog_triage_cli.run(argv, DIRECTORY)).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(backlog_triage_cli.USAGE)
		expect(order).toStrictEqual([])
	})
})

describe('josh backlog:triage --decide', () => {
	it('shows both new modes and their evidence flags on an empty invocation', async () => {
		await backlog_triage_cli.run([], DIRECTORY)

		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--pass [--exclude <N>]'))
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(
				'--decide --defect yes|no|unknown --verification yes|no|unknown --every-run yes|no|unknown',
			),
		)
	})

	it('routes a pass and refuses invalid options without writing', async () => {
		expect(await backlog_triage_cli.run(['--pass', '--force'], DIRECTORY)).toBe(FAILURE_EXIT_CODE)
		expect(order).toStrictEqual([])
	})

	it('routes the three-condition decision without writing a verdict', async () => {
		const args = ['--decide', '--defect', 'yes', VERIFICATION_FLAG, 'yes', EVERY_RUN_FLAG, 'no']

		expect(await backlog_triage_cli.run(args, DIRECTORY)).toBe(SUCCESS_EXIT_CODE)
		expect(console.info).toHaveBeenCalledWith(RUN_LANE_LABEL)
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
		expect(post_comment).toHaveBeenCalledWith(
			ISSUE,
			`triaged by backlogrun: \`${RUN_LANE_LABEL}\`\n\n${REASON}`,
		)
	})

	it('records all solo answers with run:solo (ac-30e91803, ac-ca28edeb)', async () => {
		await backlog_triage_cli.run(
			['--apply', ISSUE, '--solo', ...SOLO_ANSWERS, '--reason', REASON],
			DIRECTORY,
		)

		expect(apply_label).toHaveBeenCalledWith(ISSUE, RUN_SOLO_LABEL)
		expect(post_comment).toHaveBeenCalledWith(
			ISSUE,
			`triaged by backlogrun: \`${RUN_SOLO_LABEL}\`\n\n${REASON}\n\nsolo-run answers: defect yes · verification yes · every-run yes`,
		)
	})
})

describe('josh backlog:triage --apply failures', () => {
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
	it('names the flag beside --unblock in the usage', () => {
		expect(backlog_triage_cli.USAGE).toContain(`[${BLOCKED_BY_FLAG} <M> | ${UNBLOCK_FLAG} <M>]`)
	})

	it('records the relation in place of a run label', async () => {
		expect(await backlog_triage_cli.run(BLOCKED_ARGV, DIRECTORY)).toBe(SUCCESS_EXIT_CODE)
		expect(order).toStrictEqual([`blocked-by ${BLOCKER}`, 'comment'])
		expect(record_blocked_by).toHaveBeenCalledWith({ issue: ISSUE, prerequisite: BLOCKER })
		expect(post_comment.mock.calls[0]?.[1]).toContain(`blocked by #${BLOCKER}`)
	})

	it('records the relation before the comment and the run label when both are given', async () => {
		expect(
			await backlog_triage_cli.run([...BLOCKED_ARGV, '--solo', ...SOLO_ANSWERS], DIRECTORY),
		).toBe(SUCCESS_EXIT_CODE)
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

describe('josh backlog:triage --unblock', () => {
	it('removes the relation, then comments the reason', async () => {
		expect(await backlog_triage_cli.run(UNBLOCK_ARGV, DIRECTORY)).toBe(SUCCESS_EXIT_CODE)
		expect(order).toStrictEqual([`unblock ${BLOCKER}`, 'comment'])
		expect(remove_blocked_by).toHaveBeenCalledWith({ issue: ISSUE, prerequisite: BLOCKER })
		expect(post_comment.mock.calls[0]?.[1]).toContain(`unblocked from #${BLOCKER}`)
		expect(post_comment.mock.calls[0]?.[1]).toContain(REASON)
	})

	it('fails naming the write and comments nothing when the relation cannot be removed', async () => {
		const failure = 'the blocked-by relation was not removed'

		remove_blocked_by.mockRejectedValueOnce(new Error(failure))

		expect(await backlog_triage_cli.run(UNBLOCK_ARGV, DIRECTORY)).toBe(FAILURE_EXIT_CODE)
		expect(post_comment).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(failure))
	})

	it('fails naming the comment when the reason cannot be commented', async () => {
		post_comment.mockRejectedValueOnce(new Error('offline'))

		expect(await backlog_triage_cli.run(UNBLOCK_ARGV, DIRECTORY)).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('could not comment'))
	})
})
