import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_pr_followup, type FollowupInput } from './git-pr-followup'

// joshuafolkken/kit#3023. A pull request a person merged by hand after `prrun` stopped is finished by
// re-running `followup`: every pre-merge step is skipped and the tail runs as a merged run's. A second
// re-run finds its own completion report on the issue and posts neither it nor the Telegram again.
//
// A separate suite from `git-pr-followup.test.ts` because that file is at its length limit; the mock
// scaffolding is per suite for the reason `git-pr-followup-managed-report.test.ts` states.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_get_body: vi.fn(),
		issue_list_comments: vi.fn(),
		issue_comment: vi.fn(),
		issue_edit_body: vi.fn(),
		repo_get_name_with_owner: vi.fn(),
		issue_get_title: vi.fn(),
		pr_get_url: vi.fn(),
		pr_get_body: vi.fn(),
		pr_merge: vi.fn(),
		pr_comment: vi.fn(),
	},
}))

vi.mock('#scripts/gh/git-pr-checks', () => ({
	git_pr_checks: { wait_for_pr_success: vi.fn() },
	DEFAULT_STABLE_READS: 2,
	WATCH_CONFIRMED_STABLE_READS: 1,
}))

vi.mock('#scripts/gh/git-pr-managed-config', () => ({
	git_pr_managed_config: { handle_managed_config_changes: vi.fn(async () => []) },
}))

vi.mock('#scripts/gh/git-pr-ai-review', () => ({
	git_pr_ai_review: { handle_ai_review_findings: vi.fn() },
	has_ignore_reason(reason: string | undefined): reason is string {
		return reason !== undefined && reason.trim().length > 0
	},
}))

vi.mock('#scripts/notify/telegram-notify', () => ({
	telegram_notify: { send: vi.fn(), send_or_report: vi.fn() },
}))

vi.mock('#scripts/epic/epic-close', () => ({
	epic_close: { close_completed_epics: vi.fn() },
}))

vi.mock('./git-followup-label', () => ({
	git_followup_label: { strip_in_progress: vi.fn() },
}))

vi.mock('./git-followup-issue-close', () => ({
	git_followup_issue_close: { ensure_issue_closed: vi.fn(), CLOSE_RECOVERY: 'close by hand' },
}))

// The real one resolves the tip with `git fetch origin main`, which the network guard refuses.
vi.mock('./git-followup-pending', () => ({
	git_followup_pending: {
		MERGE_PENDING_NOTE: '',
		pending_release_line: vi.fn(),
		read_pending: vi.fn(),
	},
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const { git_pr_checks } = await import('#scripts/gh/git-pr-checks')
const { git_pr_managed_config } = await import('#scripts/gh/git-pr-managed-config')
const { telegram_notify } = await import('#scripts/notify/telegram-notify')
const { epic_close } = await import('#scripts/epic/epic-close')
const { git_followup_label } = await import('./git-followup-label')
const { git_followup_issue_close } = await import('./git-followup-issue-close')

const PR_URL = 'https://github.com/owner/repo/pull/1'
const RECORDED_REPORT = `✅ Done\nIssue: #42\nPR: ${PR_URL}`
const MERGED_AT = '2026-10-04T12:00:00Z'
const BEFORE_MERGE = '2026-10-04T11:00:00Z'
const AFTER_MERGE = '2026-10-04T13:00:00Z'

const MERGED_INPUT: FollowupInput = {
	branch_name: 'test-branch',
	issue_number: '42',
	notify_config: { target: 'issue', message: 'Done', mentions: [] },
	coderabbit_ignore_reason: undefined,
	ai_review_ignore_reason: undefined,
	is_skip_watch: true,
	should_merge: true,
	is_merged: true,
	merged_at: MERGED_AT,
}

function given_comments(bodies: ReadonlyArray<string>, created_at = AFTER_MERGE): void {
	const comments = bodies.map((body) => ({ body, created_at }))

	vi.mocked(git_gh_command.issue_list_comments).mockResolvedValue(JSON.stringify(comments))
}

function setup_gh_mocks(): void {
	vi.mocked(git_gh_command.repo_get_name_with_owner).mockResolvedValue('owner/repo')
	vi.mocked(git_gh_command.issue_get_title).mockResolvedValue('Test issue')
	vi.mocked(git_gh_command.pr_get_url).mockResolvedValue(PR_URL)
	vi.mocked(git_gh_command.pr_get_body).mockResolvedValue('closes #42')
	vi.mocked(git_gh_command.issue_get_body).mockResolvedValue('existing content')
	vi.mocked(git_gh_command.issue_comment).mockResolvedValue('')
	given_comments([])
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	setup_gh_mocks()
	vi.mocked(telegram_notify.send_or_report).mockResolvedValue(true)
	vi.mocked(epic_close.close_completed_epics).mockResolvedValue()
	vi.mocked(git_followup_label.strip_in_progress).mockResolvedValue()
	vi.mocked(git_followup_issue_close.ensure_issue_closed).mockResolvedValue()
})

describe('followup — a pull request that merged before the run', () => {
	it('does not merge it again', async () => {
		await git_pr_followup.run(MERGED_INPUT)

		expect(git_gh_command.pr_merge).not.toHaveBeenCalled()
	})

	it('skips the check wait and the managed config read', async () => {
		await git_pr_followup.run(MERGED_INPUT)

		expect(git_pr_checks.wait_for_pr_success).not.toHaveBeenCalled()
		expect(git_pr_managed_config.handle_managed_config_changes).not.toHaveBeenCalled()
	})

	it('runs the merged tail: report, Telegram, epic close, label removal, issue close', async () => {
		await git_pr_followup.run(MERGED_INPUT)

		expect(git_gh_command.issue_comment).toHaveBeenCalledTimes(1)
		expect(telegram_notify.send_or_report).toHaveBeenCalledTimes(1)
		expect(epic_close.close_completed_epics).toHaveBeenCalledWith({
			issue_number: '42',
			is_merged: true,
		})
		expect(git_followup_label.strip_in_progress).toHaveBeenCalledWith('42')
		expect(git_followup_issue_close.ensure_issue_closed).toHaveBeenCalledTimes(1)
	})
})

describe('followup — a merged pull request whose report is already on the issue', () => {
	beforeEach(() => {
		given_comments(['an unrelated comment', RECORDED_REPORT])
	})

	it('posts neither the completion report nor the Telegram again', async () => {
		await git_pr_followup.run(MERGED_INPUT)

		expect(git_gh_command.issue_comment).not.toHaveBeenCalled()
		expect(telegram_notify.send_or_report).not.toHaveBeenCalled()
	})

	it('still runs the idempotent tail steps', async () => {
		await git_pr_followup.run(MERGED_INPUT)

		expect(git_followup_label.strip_in_progress).toHaveBeenCalledWith('42')
		expect(epic_close.close_completed_epics).toHaveBeenCalledTimes(1)
	})
})

describe('followup — a merged pull request whose only report is the prrun stop’s', () => {
	beforeEach(() => {
		given_comments([RECORDED_REPORT], BEFORE_MERGE)
	})

	it('posts the merged completion report and the Telegram', async () => {
		await git_pr_followup.run(MERGED_INPUT)

		expect(git_gh_command.issue_comment).toHaveBeenCalledTimes(1)
		expect(telegram_notify.send_or_report).toHaveBeenCalledTimes(1)
	})
})
