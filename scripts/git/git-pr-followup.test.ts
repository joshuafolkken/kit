import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UNREADABLE_CR_NOTE } from './git-pr-coderabbit'
import {
	build_issue_url,
	git_pr_followup,
	post_notify_issue,
	warn_if_missing_closes,
	type FollowupInput,
} from './git-pr-followup'

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		issue_get_body: vi.fn(),
		issue_edit_body: vi.fn(),
		issue_comment: vi.fn(),
		repo_get_name_with_owner: vi.fn(),
		issue_get_title: vi.fn(),
		pr_get_url: vi.fn(),
		pr_get_body: vi.fn(),
		pr_get_review_comments: vi.fn(),
		pr_get_comments: vi.fn(),
		pr_merge: vi.fn(),
		pr_comment: vi.fn(),
	},
}))

vi.mock('./git-pr-checks', () => ({
	git_pr_checks: {
		wait_for_pr_success: vi.fn(),
	},
}))

vi.mock('./git-pr-ai-review', () => ({
	git_pr_ai_review: {
		handle_ai_review_findings: vi.fn(),
	},
	has_ignore_reason(reason: string | undefined): reason is string {
		return reason !== undefined && reason.trim().length > 0
	},
}))

vi.mock('./telegram-notify', () => ({
	telegram_notify: {
		send: vi.fn(),
	},
}))

const { git_gh_command } = await import('./git-gh-command')
const { git_pr_checks } = await import('./git-pr-checks')
const { git_pr_ai_review } = await import('./git-pr-ai-review')
const { telegram_notify } = await import('./telegram-notify')

const PR_URL = 'https://github.com/owner/repo/pull/1'

const BASE_INPUT: FollowupInput = {
	branch_name: 'test-branch',
	issue_number: '42',
	notify_config: undefined,
	coderabbit_ignore_reason: undefined,
	ai_review_ignore_reason: undefined,
	is_skip_watch: true,
	should_merge: false,
}

const mocked_get_body = vi.mocked(git_gh_command.issue_get_body)
const mocked_edit_body = vi.mocked(git_gh_command.issue_edit_body)
const mocked_comment = vi.mocked(git_gh_command.issue_comment)
const mocked_pr_get_body = vi.mocked(git_gh_command.pr_get_body)

// The body of the completion notification the run sent, or undefined when it sent none.
function notify_body(): string | undefined {
	return (vi.mocked(telegram_notify.send).mock.calls[0] ?? [])[0]?.body
}

function silence_warnings(): void {
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

function setup_run_mocks(): void {
	vi.mocked(git_gh_command.repo_get_name_with_owner).mockResolvedValue('owner/repo')
	vi.mocked(git_gh_command.issue_get_title).mockResolvedValue('Test issue')
	vi.mocked(git_gh_command.pr_get_url).mockResolvedValue(PR_URL)
	vi.mocked(git_gh_command.pr_get_body).mockResolvedValue('closes #42')
	vi.mocked(git_pr_checks.wait_for_pr_success).mockResolvedValue({
		rollup: [],
		merge_state_status: undefined,
		review_decision: undefined,
	})
	vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue('[]')
	vi.mocked(git_pr_ai_review.handle_ai_review_findings).mockResolvedValue([])
	vi.mocked(telegram_notify.send).mockResolvedValue()
	vi.mocked(git_gh_command.pr_merge).mockResolvedValue()
}

function setup_skip_policy_mocks(): void {
	vi.clearAllMocks()
	silence_warnings()
	setup_run_mocks()
}

describe('post_notify_issue — blank body uses edit, non-blank uses comment', () => {
	const ISSUE_NUMBER = '42'
	const NOTIFY_BODY = 'Completion notification'

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('calls issue_edit_body when issue body is blank', async () => {
		mocked_get_body.mockResolvedValue('')
		mocked_edit_body.mockResolvedValue('')

		await post_notify_issue({ issue_number: ISSUE_NUMBER, body: NOTIFY_BODY })

		expect(mocked_edit_body).toHaveBeenCalledWith(ISSUE_NUMBER, NOTIFY_BODY)
		expect(mocked_comment).not.toHaveBeenCalled()
	})

	it('calls issue_comment when issue body is non-blank', async () => {
		mocked_get_body.mockResolvedValue('existing content')
		mocked_comment.mockResolvedValue('')

		await post_notify_issue({ issue_number: ISSUE_NUMBER, body: NOTIFY_BODY })

		expect(mocked_comment).toHaveBeenCalledWith(ISSUE_NUMBER, NOTIFY_BODY)
		expect(mocked_edit_body).not.toHaveBeenCalled()
	})

	it('falls back to issue_comment when body fetch fails (undefined)', async () => {
		mocked_get_body.mockResolvedValue(undefined)
		mocked_comment.mockResolvedValue('')

		await post_notify_issue({ issue_number: ISSUE_NUMBER, body: NOTIFY_BODY })

		expect(mocked_comment).toHaveBeenCalledWith(ISSUE_NUMBER, NOTIFY_BODY)
		expect(mocked_edit_body).not.toHaveBeenCalled()
	})

	it('throws when issue_number is undefined', async () => {
		await expect(post_notify_issue({ issue_number: undefined, body: NOTIFY_BODY })).rejects.toThrow(
			'Issue number is required for issue notification.',
		)
	})
})

describe('warn_if_missing_closes', () => {
	const BRANCH = 'my-feature-branch'

	beforeEach(() => {
		vi.clearAllMocks()
		silence_warnings()
	})

	it('prints a warning when PR body has no closes keyword', async () => {
		mocked_pr_get_body.mockResolvedValue('## Summary\nNo issue link here')

		await warn_if_missing_closes(BRANCH)

		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('closes #N'))
	})

	it('prints no warning when PR body contains closes keyword', async () => {
		mocked_pr_get_body.mockResolvedValue('closes #99\n\n## Details')

		await warn_if_missing_closes(BRANCH)

		expect(console.warn).not.toHaveBeenCalled()
	})

	it('prints a warning when PR body is undefined (fetch failed)', async () => {
		mocked_pr_get_body.mockResolvedValue(undefined)

		await warn_if_missing_closes(BRANCH)

		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('closes #N'))
	})
})

describe('git_pr_followup.run — --merge flag', () => {
	beforeEach(setup_skip_policy_mocks)

	it('calls notify before pr_merge when should_merge is true', async () => {
		await git_pr_followup.run({ ...BASE_INPUT, should_merge: true })

		const [notify_order] = vi.mocked(telegram_notify.send).mock.invocationCallOrder
		const [merge_order] = vi.mocked(git_gh_command.pr_merge).mock.invocationCallOrder

		expect(notify_order).toBeLessThan(merge_order ?? Infinity)
	})

	it('calls pr_merge with the branch name when should_merge is true', async () => {
		await git_pr_followup.run({ ...BASE_INPUT, should_merge: true })

		expect(vi.mocked(git_gh_command.pr_merge)).toHaveBeenCalledWith(BASE_INPUT.branch_name)
	})

	it('does not call pr_merge when should_merge is false', async () => {
		await git_pr_followup.run({ ...BASE_INPUT, should_merge: false })

		expect(vi.mocked(git_gh_command.pr_merge)).not.toHaveBeenCalled()
	})
})

// cspell:words coderabbit coderabbitai
const UNRESOLVED_CODERABBIT_COMMENT = {
	body: '_⚠️ Potential issue_\n\nPossible null dereference in parser.',
	html_url: 'https://github.com/owner/repo/pull/1#discussion_r1',
	user: { login: 'coderabbitai[bot]' },
}

const IGNORE_REASON = 'Tracked in follow-up Issue #999'

describe('git_pr_followup.run — temporary CodeRabbit skip (kit#753)', () => {
	beforeEach(setup_skip_policy_mocks)

	it('does not throw on unresolved CodeRabbit comments without an ignore reason', async () => {
		vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue(
			JSON.stringify([UNRESOLVED_CODERABBIT_COMMENT]),
		)

		await git_pr_followup.run({ ...BASE_INPUT, should_merge: true })

		expect(vi.mocked(git_gh_command.pr_merge)).toHaveBeenCalledWith(BASE_INPUT.branch_name)
		expect(vi.mocked(git_gh_command.pr_comment)).not.toHaveBeenCalled()
	})

	it('includes a skip note in the completion notification for unresolved comments', async () => {
		vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue(
			JSON.stringify([UNRESOLVED_CODERABBIT_COMMENT]),
		)

		await git_pr_followup.run({ ...BASE_INPUT, should_merge: false })

		expect(notify_body()).toContain('kit#753')
		expect(notify_body()).toContain(UNRESOLVED_CODERABBIT_COMMENT.html_url)
	})
})

describe('git_pr_followup.run — CodeRabbit skip audit trail (kit#753)', () => {
	beforeEach(setup_skip_policy_mocks)

	it('includes a skip note when the CodeRabbit check was not passing at merge time', async () => {
		vi.mocked(git_pr_checks.wait_for_pr_success).mockResolvedValue({
			rollup: [
				{ name: 'CodeRabbit', status: 'pending' },
				{ name: 'SonarQube', status: 'pass' },
			],
			merge_state_status: 'UNSTABLE',
			review_decision: undefined,
		})

		await git_pr_followup.run({ ...BASE_INPUT, should_merge: false })

		expect(notify_body()).toContain('CodeRabbit check skipped (kit#753)')
		expect(notify_body()).toContain('pending')
	})

	it('still posts the audit comment when an ignore reason is supplied', async () => {
		vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue(
			JSON.stringify([UNRESOLVED_CODERABBIT_COMMENT]),
		)
		vi.mocked(git_gh_command.pr_comment).mockResolvedValue('')

		await git_pr_followup.run({
			...BASE_INPUT,
			coderabbit_ignore_reason: IGNORE_REASON,
		})

		const [, comment_body] = vi.mocked(git_gh_command.pr_comment).mock.calls[0] ?? []

		expect(comment_body).toContain('intentionally left unresolved')
		expect(comment_body).toContain(IGNORE_REASON)
	})
})

// joshuafolkken/kit#973: `pr_get_review_comments` turned every failure into `'[]'`, so an unreadable
// listing passed as "nothing unresolved". CodeRabbit does not block the merge at all right now
// (kit#753), so this cannot block either — but it must say so rather than pass in silence.
describe('git_pr_followup.run — CodeRabbit comments that could not be read (kit#973)', () => {
	beforeEach(setup_skip_policy_mocks)

	// `undefined` is a failed read; the object is the rate-limit shape — valid JSON, not a listing.
	it.each([undefined, '{"message":"API rate limit exceeded"}'])(
		'records that the listing went unread (%s)',
		async (listing) => {
			vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue(listing)

			await git_pr_followup.run({ ...BASE_INPUT, should_merge: false })

			expect(notify_body()).toContain(UNREADABLE_CR_NOTE)
		},
	)

	it('still merges, because CodeRabbit is non-blocking under kit#753', async () => {
		vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue(undefined)

		await git_pr_followup.run({ ...BASE_INPUT, should_merge: true })

		expect(vi.mocked(git_gh_command.pr_merge)).toHaveBeenCalledWith(BASE_INPUT.branch_name)
	})

	// The audit trail an ignore reason leaves on the two branches around this one.
	it('records an ignore reason on the pull request when one was supplied', async () => {
		vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue(undefined)
		vi.mocked(git_gh_command.pr_comment).mockResolvedValue('')

		await git_pr_followup.run({ ...BASE_INPUT, coderabbit_ignore_reason: IGNORE_REASON })

		const [, comment_body] = vi.mocked(git_gh_command.pr_comment).mock.calls[0] ?? []

		expect(comment_body).toContain(UNREADABLE_CR_NOTE)
		expect(comment_body).toContain(IGNORE_REASON)
	})

	it('posts nothing to the pull request when no ignore reason was supplied', async () => {
		vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue(undefined)

		await git_pr_followup.run({ ...BASE_INPUT, should_merge: false })

		expect(vi.mocked(git_gh_command.pr_comment)).not.toHaveBeenCalled()
	})

	// `[]` is an answer: the PR has no line comments, so there is nothing to record.
	it('says nothing when the pull request genuinely has no line comments', async () => {
		vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue('[]')

		await git_pr_followup.run({ ...BASE_INPUT, should_merge: false })

		expect(notify_body()).not.toContain(UNREADABLE_CR_NOTE)
	})
})

// joshuafolkken/kit#994 replaced this function's own end-anchored pull-URL regex with the shared
// parser, which stops at a word boundary instead. The widening is deliberate — a link copied from a
// file view names the same repository — but nothing pinned either the new acceptance or the
// rejections that must survive it.
describe('build_issue_url', () => {
	const KIT_PULL_URL = 'https://github.com/joshuafolkken/kit/pull/1004'
	const KIT_ISSUE_URL = 'https://github.com/joshuafolkken/kit/issues/994'
	const ISSUE_NUMBER = '994'

	it('builds the sibling issue URL of a pull request', () => {
		expect(build_issue_url(KIT_PULL_URL, ISSUE_NUMBER)).toBe(KIT_ISSUE_URL)
	})

	it('reads a pull URL that continues past the number', () => {
		expect(build_issue_url(`${KIT_PULL_URL}/files`, ISSUE_NUMBER)).toBe(KIT_ISSUE_URL)
	})

	it('builds it for a repository other than the one the session runs in', () => {
		expect(build_issue_url('https://github.com/joshuafolkken/app-kit/pull/7', ISSUE_NUMBER)).toBe(
			'https://github.com/joshuafolkken/app-kit/issues/994',
		)
	})

	it('returns undefined without an issue number', () => {
		expect(build_issue_url(KIT_PULL_URL, undefined)).toBeUndefined()
	})

	it('returns undefined without a pull URL', () => {
		expect(build_issue_url(undefined, ISSUE_NUMBER)).toBeUndefined()
	})

	it('returns undefined for a URL that is not a pull request', () => {
		expect(build_issue_url(KIT_ISSUE_URL, ISSUE_NUMBER)).toBeUndefined()
	})

	it('returns undefined for a non-github host', () => {
		expect(build_issue_url('https://example.com/a/b/pull/1', ISSUE_NUMBER)).toBeUndefined()
	})
})
