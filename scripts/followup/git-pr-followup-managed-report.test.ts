import { CODERABBIT_CHECK_NAME, FAILURE_MESSAGE_PREFIX } from '#scripts/gh/git-pr-checks-eval'
import { DISTRIBUTED_SKILL_FILE } from '#scripts/managed-marker/managed-config-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_pr_followup, type FollowupInput } from './git-pr-followup'

// Managed config changes need a report in both destinations while CI continues, especially in kit
// where editing the distributed source is expected (joshuafolkken/kit#1592, #1413).
//
// **`./git-pr-managed-config` is deliberately left real**, unlike in `git-pr-followup.test.ts` where
// it is mocked to keep that suite off the working copy. Here the composed report *is* what is under
// test — the heading, the path and the list name as `format_hit` actually writes them — so mocking it
// would leave the shape asserted only against a literal this file invented. What is mocked instead is
// the one thing underneath it that reads the tree: the branch diff.
//
// A separate suite from `git-pr-followup.test.ts` for the reason `git-pr-followup-stages.test.ts` and
// `git-pr-followup-watch.test.ts` are separate suites — that file is at its length limit — and the
// mock scaffolding is per suite for the reason stated there: a `vi.mock` factory is registered for
// the file it is written in, and these two do not mock the same set.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { diff_main_names: vi.fn() },
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_view_json: vi.fn(),
		issue_comment: vi.fn(),
		issue_edit_body: vi.fn(),
		repo_get_name_with_owner: vi.fn(),
		issue_get_title: vi.fn(),
		pr_get_url: vi.fn(),
		pr_get_body: vi.fn(),
		pr_get_review_comments: vi.fn(),
		pr_merge: vi.fn(),
		pr_comment: vi.fn(),
	},
}))

vi.mock('#scripts/issue/issue-watch-gate', () => ({
	issue_watch_gate: { assert_read_here: vi.fn() },
}))

vi.mock('#scripts/gh/git-pr-checks', () => ({
	git_pr_checks: { wait_for_pr_success: vi.fn() },
	DEFAULT_STABLE_READS: 2,
	WATCH_CONFIRMED_STABLE_READS: 1,
}))

// `has_ignore_reason` is part of the factory even though this suite never reaches it: it is a named
// export `git-pr-coderabbit.ts` imports, so a case that put an unresolved thread in front of the run
// would die on a missing mock rather than on its assertion — the same reason the sibling suites
// supply it.
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

// This suite drives the whole `run()`, which now reaches the observation-ledger flush in the
// post-merge tail (joshuafolkken/kit#1810); its own behavior is `git-followup-flush.test.ts`.
vi.mock('./git-followup-flush', () => ({
	git_followup_flush: { flush_ledger_step: vi.fn() },
}))

vi.mock('./followup-job-rerun', () => ({
	followup_job_rerun: { rerun_failed_jobs: vi.fn() },
}))

// The real one resolves the tip with `git fetch origin main`, which the network guard refuses and
// which nothing here asserts on.
vi.mock('./git-followup-pending', () => ({
	git_followup_pending: {
		MERGE_PENDING_NOTE: '',
		pending_release_line: vi.fn(),
		read_pending: vi.fn(),
	},
}))

const { git_command } = await import('#scripts/git/git-command')
const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const { git_pr_checks } = await import('#scripts/gh/git-pr-checks')
const { git_pr_ai_review } = await import('#scripts/gh/git-pr-ai-review')
const { telegram_notify } = await import('#scripts/notify/telegram-notify')
const { epic_close } = await import('#scripts/epic/epic-close')
const { followup_job_rerun } = await import('./followup-job-rerun')

const PR_URL = 'https://github.com/owner/repo/pull/1'
const CHECKED_SHA = 'c0ffee1'
const UNDISTRIBUTED_FILE = 'scripts/followup/git-pr-followup.ts'
const PATHS_HEADING = 'Distributed paths in this diff:'
// What `format_hit` actually writes: the path, then the list that claimed it, in brackets. Asserted
// as one string rather than two `toContain` calls, so a report that named the path and dropped the
// list would fail here.
const EXPECTED_HIT = `${DISTRIBUTED_SKILL_FILE} (PLUGIN_SKILL_DIRECTORIES)`

const BASE_INPUT: FollowupInput = {
	branch_name: 'test-branch',
	issue_number: '42',
	notify_config: { target: 'issue', message: 'Done', mentions: [] },
	coderabbit_ignore_reason: undefined,
	ai_review_ignore_reason: undefined,
	is_skip_watch: true,
	should_merge: true,
}

function given_changed(paths: ReadonlyArray<string>): void {
	vi.mocked(git_command.diff_main_names).mockResolvedValue(paths.join('\n'))
}

// The body of the completion notification, and the body of the completion report posted to the Issue.
function notify_body(): string | undefined {
	return (vi.mocked(telegram_notify.send_or_report).mock.calls[0] ?? [])[0]?.body
}

function issue_comment_body(): string | undefined {
	return vi.mocked(git_gh_command.issue_comment).mock.calls[0]?.[1]
}

function setup_gh_mocks(): void {
	vi.mocked(git_gh_command.repo_get_name_with_owner).mockResolvedValue('owner/repo')
	vi.mocked(git_gh_command.issue_get_title).mockResolvedValue('Test issue')
	vi.mocked(git_gh_command.pr_get_url).mockResolvedValue(PR_URL)
	vi.mocked(git_gh_command.pr_get_body).mockResolvedValue('closes #42')
	vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue('[]')
	vi.mocked(git_gh_command.issue_view_json).mockResolvedValue('{"body":"existing content"}')
	vi.mocked(git_gh_command.issue_comment).mockResolvedValue('')
	vi.mocked(git_gh_command.pr_merge).mockResolvedValue()
}

function setup_run_mocks(): void {
	vi.mocked(git_pr_checks.wait_for_pr_success).mockResolvedValue({
		rollup: [],
		merge_state_status: undefined,
		review_decision: undefined,
		head_sha: CHECKED_SHA,
	})
	vi.mocked(git_pr_ai_review.handle_ai_review_findings).mockResolvedValue([])
	vi.mocked(telegram_notify.send_or_report).mockResolvedValue(true)
	vi.mocked(epic_close.close_completed_epics).mockResolvedValue()
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	setup_gh_mocks()
	setup_run_mocks()
})

describe('followup — a diff that changes a distributed file', () => {
	beforeEach(() => {
		given_changed([UNDISTRIBUTED_FILE, DISTRIBUTED_SKILL_FILE])
	})

	// Reporting a managed change must allow the CI wait to begin.
	it('merges instead of stopping', async () => {
		await git_pr_followup.run(BASE_INPUT)

		expect(vi.mocked(git_gh_command.pr_merge)).toHaveBeenCalledWith(
			BASE_INPUT.branch_name,
			CHECKED_SHA,
		)
	})

	it('names the path and the list that claimed it in the completion notification', async () => {
		await git_pr_followup.run(BASE_INPUT)

		expect(notify_body()).toContain(EXPECTED_HIT)
	})

	it('names the same path and list in the completion report on the Issue', async () => {
		await git_pr_followup.run(BASE_INPUT)

		expect(issue_comment_body()).toContain(EXPECTED_HIT)
	})
})

// joshuafolkken/kit#5545: the check report `followup` drafts reaches both destinations too.
describe('followup — a check report', () => {
	const REPORT_LINE = `- ${CODERABBIT_CHECK_NAME} — failed (not required)`

	beforeEach(() => {
		given_changed([UNDISTRIBUTED_FILE])
		vi.mocked(git_pr_checks.wait_for_pr_success).mockResolvedValue({
			rollup: [{ name: CODERABBIT_CHECK_NAME, status: 'fail' }],
			merge_state_status: undefined,
			review_decision: undefined,
			head_sha: CHECKED_SHA,
		})
	})

	it('names the failed check in the completion notification', async () => {
		await git_pr_followup.run(BASE_INPUT)

		expect(notify_body()).toContain(REPORT_LINE)
	})

	it('names the same check in the completion report on the Issue', async () => {
		await git_pr_followup.run(BASE_INPUT)

		expect(issue_comment_body()).toContain(REPORT_LINE)
	})

	it('names the job the check wait reran as flaky', async () => {
		const job = 'Detect E2E'

		vi.mocked(git_pr_checks.wait_for_pr_success).mockRejectedValueOnce(
			new Error(`${FAILURE_MESSAGE_PREFIX} (failed checks: ${job}).`),
		)
		vi.mocked(followup_job_rerun.rerun_failed_jobs).mockResolvedValue([job])

		await git_pr_followup.run(BASE_INPUT)

		expect(issue_comment_body()).toContain(`- ${job} — re-run once`)
	})
})

describe('followup — a diff that distributes nothing', () => {
	beforeEach(() => {
		given_changed([UNDISTRIBUTED_FILE])
	})

	it('puts no such section in the completion notification', async () => {
		await git_pr_followup.run(BASE_INPUT)

		expect(notify_body()).not.toContain(PATHS_HEADING)
	})

	it('puts no such section in the completion report on the Issue', async () => {
		await git_pr_followup.run(BASE_INPUT)

		expect(issue_comment_body()).not.toContain(PATHS_HEADING)
	})
})
