import { git_gh_command } from '#scripts/gh/git-gh-command'
import { listing_of } from '#scripts/gh/git-gh-issue-list-fixture'
import { issue_auto_ok } from '#scripts/issue/issue-auto-ok'
import { issue_read } from '#scripts/issue/issue-read'
import { issue_watch_diff } from '#scripts/issue/issue-watch-diff'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auto_ok_judge } from './auto-ok-judge'
import { auto_ok_judge_cli } from './auto-ok-judge-cli'
import {
	auto_ok_kickoff_fixture,
	KICKOFF_BODY,
	KICKOFF_PLAN,
	USER_PROHIBITION,
} from './auto-ok-kickoff-fixture'

const ISSUE = 7379
const SUCCESS = 0
const FAILURE = 1
const LABELS = ['bug', 'run:lane']
const TITLE = 'Fix timing'

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'issue_comment').mockResolvedValue('')
	vi.spyOn(git_gh_command, 'issue_apply_label').mockResolvedValue({ is_applied: true })
	vi.spyOn(git_gh_command, 'issue_get_labels_and_body').mockResolvedValue(
		JSON.stringify({
			body: KICKOFF_BODY,
			labels: LABELS.map((name) => ({ name })),
		}),
	)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('the shared Claude/Codex kickoff-to-judgement contract', () => {
	it('offers #7379 again and applies after the automated plan and legacy decline', async () => {
		vi.spyOn(git_gh_command, 'issue_list_open_for_judgement').mockResolvedValue(
			listing_of([
				{
					number: ISSUE,
					title: TITLE,
					body: KICKOFF_BODY,
					labels: [],
					updatedAt: 'unchanged',
					author_association: 'OWNER',
				},
			]),
		)
		vi.spyOn(git_gh_command, 'issue_list_comments').mockResolvedValue(
			auto_ok_kickoff_fixture.legacy_comments(),
		)
		expect(await auto_ok_judge_cli.run([])).toBe(SUCCESS)
		expect(console.info).toHaveBeenCalledWith(String(ISSUE))
		expect(await auto_ok_judge_cli.run(['--apply', String(ISSUE), '--lane'])).toBe(SUCCESS)
		expect(git_gh_command.issue_apply_label).toHaveBeenLastCalledWith(String(ISSUE), 'auto-ok')
		const posted = vi.mocked(git_gh_command.issue_comment).mock.calls[0]?.[1] ?? ''
		const comments = await issue_watch_diff.parse_comments(
			JSON.stringify([{ id: ISSUE, body: posted, author_association: 'OWNER' }]),
		)

		expect(auto_ok_judge.is_judged(KICKOFF_BODY, comments ?? [])).toBe(true)
	})
})

describe('the shared Claude/Codex source distinction', () => {
	it('exposes the actual automated provenance rather than upgrading owner trust to a user instruction', async () => {
		const comments = await issue_read.parse_comments(auto_ok_kickoff_fixture.legacy_comments())
		const report = issue_read.format_issue(
			String(ISSUE),
			{ title: TITLE, state: 'OPEN', body: KICKOFF_BODY, is_body_trusted: true },
			comments,
		)

		expect(report).toContain(KICKOFF_PLAN)
		expect(comments?.map((row) => row.is_automated)).toEqual([true, true])
		expect(report.match(/\[trusted\] \[automated\]/gu)).toHaveLength(2)
	})

	it('keeps a verified original user prohibition at filing and refuses a later apply', async () => {
		const body = `${KICKOFF_BODY}${USER_PROHIBITION}`
		const filing = { body, labels: LABELS, is_opted_out: true, is_cross_repository: false }

		vi.mocked(git_gh_command.issue_get_labels_and_body).mockResolvedValue(
			JSON.stringify({ body, labels: [] }),
		)

		expect(issue_auto_ok.opt_out_problem(filing)).toBeUndefined()
		expect(issue_auto_ok.decide(filing).is_applied).toBe(false)
		expect(await auto_ok_judge_cli.run(['--apply', String(ISSUE), '--lane'])).toBe(FAILURE)
		expect(git_gh_command.issue_comment).not.toHaveBeenCalled()
		expect(git_gh_command.issue_apply_label).not.toHaveBeenCalled()
	})
})
