import { issue_cite } from '#scripts/issue/issue-cite'
import { AUTO_OK_LABEL, DEFERRED_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE } from './auto-ok-fixture'
import { auto_ok_judge_fixture, DECLINED, OWED_NUMBER } from './auto-ok-judge-fixture'
import { auto_ok_judge_write } from './auto-ok-judge-write'

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_get_labels_and_body: vi.fn(),
		issue_apply_label: vi.fn(),
		issue_comment: vi.fn(),
	},
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const read_issue = vi.mocked(git_gh_command.issue_get_labels_and_body)
const apply_label = vi.mocked(git_gh_command.issue_apply_label)
const post_comment = vi.mocked(git_gh_command.issue_comment)
const emit = vi.spyOn(run_event_stream_emit, 'emit')
const ISSUE = String(OWED_NUMBER)
const { labels_and_body } = auto_ok_judge_fixture

vi.spyOn(console, 'info').mockImplementation(() => undefined)
vi.spyOn(console, 'error').mockImplementation(() => undefined)

beforeEach(() => {
	vi.clearAllMocks()
	apply_label.mockResolvedValue({ is_applied: true })
	post_comment.mockResolvedValue('')
	emit.mockResolvedValue()
})

describe('auto_ok_judge_write.apply', () => {
	it('applies the run label before auto-ok, notes it and records the judgement', async () => {
		read_issue.mockResolvedValueOnce(labels_and_body([]))

		expect(await auto_ok_judge_write.apply(ISSUE, RUN_LANE_LABEL)).toBe(SUCCESS_EXIT_CODE)
		expect(apply_label.mock.calls.map(([, label]) => label)).toStrictEqual([
			RUN_LANE_LABEL,
			AUTO_OK_LABEL,
		])
		expect(emit).toHaveBeenCalledWith(
			expect.anything(),
			`${issue_cite.plain(ISSUE)} auto-ok applied (${RUN_LANE_LABEL})`,
		)
		expect(post_comment.mock.calls[0]?.[1]).toContain('<!-- josh:auto-ok-judged body=')
	})

	it('refuses an issue that gained an excluded label since the listing', async () => {
		read_issue.mockResolvedValueOnce(labels_and_body([DEFERRED_LABEL]))

		expect(await auto_ok_judge_write.apply(ISSUE, RUN_LANE_LABEL)).toBe(FAILURE_EXIT_CODE)
		expect(apply_label).not.toHaveBeenCalled()
		expect(post_comment).not.toHaveBeenCalled()
	})

	it('refuses an issue it cannot read', async () => {
		read_issue.mockResolvedValueOnce(undefined)

		expect(await auto_ok_judge_write.apply(ISSUE, RUN_LANE_LABEL)).toBe(FAILURE_EXIT_CODE)
		expect(apply_label).not.toHaveBeenCalled()
	})
})

describe('auto_ok_judge_write.decline', () => {
	it('records the reason as a judgement comment and applies nothing', async () => {
		read_issue.mockResolvedValueOnce(labels_and_body([]))

		expect(await auto_ok_judge_write.decline(ISSUE, DECLINED.reason)).toBe(SUCCESS_EXIT_CODE)
		expect(apply_label).not.toHaveBeenCalled()
		expect(post_comment.mock.calls[0]?.[1]).toContain(DECLINED.reason)
	})

	it('fails when the judgement comment cannot be posted', async () => {
		read_issue.mockResolvedValueOnce(labels_and_body([]))
		post_comment.mockRejectedValueOnce(new Error('offline'))

		expect(await auto_ok_judge_write.decline(ISSUE, DECLINED.reason)).toBe(FAILURE_EXIT_CODE)
	})
})
