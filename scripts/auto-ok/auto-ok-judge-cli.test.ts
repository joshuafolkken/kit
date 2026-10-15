import { listing_of, listing_outcome } from '#scripts/gh/git-gh-issue-list-fixture'
import { RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auto_ok_fixture, FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE } from './auto-ok-fixture'
import { auto_ok_judge_cli } from './auto-ok-judge-cli'
import {
	auto_ok_judge_fixture,
	DECLINED,
	JUDGED_NUMBER,
	OWED_NUMBER,
} from './auto-ok-judge-fixture'

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_list_open_for_judgement: vi.fn(),
		issue_list_comments: vi.fn(),
		issue_get_labels_and_body: vi.fn(),
		issue_apply_label: vi.fn(),
		issue_comment: vi.fn(),
	},
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const list_open = vi.mocked(git_gh_command.issue_list_open_for_judgement)
const list_comments = vi.mocked(git_gh_command.issue_list_comments)
const read_issue = vi.mocked(git_gh_command.issue_get_labels_and_body)
const apply_label = vi.mocked(git_gh_command.issue_apply_label)
const post_comment = vi.mocked(git_gh_command.issue_comment)
const emit = vi.spyOn(run_event_stream_emit, 'emit')
const { row, labels_and_body } = auto_ok_judge_fixture

const streams = auto_ok_fixture.console_streams()
const { stdout, stderr } = streams

vi.spyOn(console, 'info').mockImplementation(streams.info)
vi.spyOn(console, 'error').mockImplementation(streams.error)

beforeEach(() => {
	vi.clearAllMocks()
	list_open.mockResolvedValue(listing_outcome(undefined))
	list_comments.mockImplementation(async (issue) => auto_ok_judge_fixture.comments_of(issue))
	apply_label.mockResolvedValue({ is_applied: true })
	post_comment.mockResolvedValue('')
	emit.mockResolvedValue()
	streams.reset()
})

describe('josh auto-ok:judge — the listing', () => {
	it('prints each owed number on stdout and its citation on stderr', async () => {
		list_open.mockResolvedValueOnce(listing_of([row(OWED_NUMBER), row(JUDGED_NUMBER)]))

		expect(await auto_ok_judge_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OWED_NUMBER))
		expect(stderr()).toContain(session_cite.issue(OWED_NUMBER, `Issue ${String(OWED_NUMBER)}`))
	})

	it('prints none when every candidate is already judged', async () => {
		list_open.mockResolvedValueOnce(listing_of([row(JUDGED_NUMBER)]))

		expect(await auto_ok_judge_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(auto_ok_judge_cli.NONE_TOKEN)
	})

	it('fails rather than answering none when the listing cannot be read', async () => {
		expect(await auto_ok_judge_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(stdout()).toBe('')
	})
})

describe('josh auto-ok:judge --apply / --decline', () => {
	it('names the solo label when --solo is given', async () => {
		read_issue.mockResolvedValueOnce(labels_and_body([]))

		await auto_ok_judge_cli.run(['--apply', String(OWED_NUMBER), '--solo'])

		expect(apply_label.mock.calls[0]?.[1]).toBe(RUN_SOLO_LABEL)
	})

	it('passes the --reason text through to the judgement comment', async () => {
		read_issue.mockResolvedValueOnce(labels_and_body([]))

		expect(
			await auto_ok_judge_cli.run(['--decline', String(OWED_NUMBER), '--reason', DECLINED.reason]),
		).toBe(SUCCESS_EXIT_CODE)
		expect(post_comment.mock.calls[0]?.[1]).toContain(DECLINED.reason)
	})
})

describe('josh auto-ok:judge — usage', () => {
	it.each([
		[['--apply', String(OWED_NUMBER)]],
		[['--apply', String(OWED_NUMBER), '--lane', '--solo']],
		[['--decline', String(OWED_NUMBER)]],
		[['--apply', 'abc', '--lane']],
		[['--apply', String(OWED_NUMBER), '--decline', String(OWED_NUMBER), '--lane']],
	])('refuses %j with the usage line', async (argv) => {
		expect(await auto_ok_judge_cli.run(argv)).toBe(FAILURE_EXIT_CODE)
		expect(stderr()).toContain('Usage: josh auto-ok:judge')
	})
})
