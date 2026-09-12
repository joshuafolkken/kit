import { DISTRIBUTED_SKILL_FILE } from '#scripts/managed-config-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_pr_followup, type FollowupInput } from './git-pr-followup'

// joshuafolkken/kit#1592. The managed config-file answer used to end the run before the CI wait, and
// in kit — the distribution source — the condition it tests is true of nearly every change: two of
// three children of `epicrun #1413` stopped here over changes those Issues had themselves ordered. It
// reports now, into **both** destinations, and this suite is what pins that end to end.
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

vi.mock('./git-command', () => ({
	git_command: { diff_main_names: vi.fn() },
}))

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		issue_get_body: vi.fn(),
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

vi.mock('./git-pr-checks', () => ({
	git_pr_checks: { wait_for_pr_success: vi.fn() },
}))

// `has_ignore_reason` is part of the factory even though this suite never reaches it: it is a named
// export `git-pr-coderabbit.ts` imports, so a case that put an unresolved thread in front of the run
// would die on a missing mock rather than on its assertion — the same reason the sibling suites
// supply it.
vi.mock('./git-pr-ai-review', () => ({
	git_pr_ai_review: { handle_ai_review_findings: vi.fn() },
	has_ignore_reason(reason: string | undefined): reason is string {
		return reason !== undefined && reason.trim().length > 0
	},
}))

vi.mock('./telegram-notify', () => ({
	telegram_notify: { send: vi.fn(), send_or_report: vi.fn() },
}))

vi.mock('./git-epic-close', () => ({
	git_epic_close: { close_completed_epics: vi.fn() },
}))

// This suite drives the whole `run()`, which now reaches the observation-ledger flush in the
// post-merge tail (joshuafolkken/kit#1810); its own behavior is `git-followup-flush.test.ts`.
vi.mock('./git-followup-flush', () => ({
	git_followup_flush: { flush_ledger_step: vi.fn() },
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

const { git_command } = await import('./git-command')
const { git_gh_command } = await import('./git-gh-command')
const { git_pr_checks } = await import('./git-pr-checks')
const { git_pr_ai_review } = await import('./git-pr-ai-review')
const { telegram_notify } = await import('./telegram-notify')
const { git_epic_close } = await import('./git-epic-close')

const PR_URL = 'https://github.com/owner/repo/pull/1'
const UNDISTRIBUTED_FILE = 'scripts/git/git-pr-followup.ts'
const PATHS_HEADING = 'Distributed paths in this diff:'
// What `format_hit` actually writes: the path, then the list that claimed it, in brackets. Asserted
// as one string rather than two `toContain` calls, so a report that named the path and dropped the
// list would fail here.
const EXPECTED_HIT = `${DISTRIBUTED_SKILL_FILE} (AI_COPY_DIRECTORIES)`

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
	vi.mocked(git_gh_command.issue_get_body).mockResolvedValue('existing content')
	vi.mocked(git_gh_command.issue_comment).mockResolvedValue('')
	vi.mocked(git_gh_command.pr_merge).mockResolvedValue()
}

function setup_run_mocks(): void {
	vi.mocked(git_pr_checks.wait_for_pr_success).mockResolvedValue({
		rollup: [],
		merge_state_status: undefined,
		review_decision: undefined,
	})
	vi.mocked(git_pr_ai_review.handle_ai_review_findings).mockResolvedValue([])
	vi.mocked(telegram_notify.send_or_report).mockResolvedValue(true)
	vi.mocked(git_epic_close.close_completed_epics).mockResolvedValue()
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

	// The change itself. This used to throw before the CI wait was even entered.
	it('merges instead of stopping', async () => {
		await git_pr_followup.run(BASE_INPUT)

		expect(vi.mocked(git_gh_command.pr_merge)).toHaveBeenCalledWith(BASE_INPUT.branch_name)
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
