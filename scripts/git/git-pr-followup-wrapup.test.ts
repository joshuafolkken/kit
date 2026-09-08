import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_epic_close } from './git-epic-close'
import { git_followup_stages } from './git-followup-stages'
import { git_gh_command } from './git-gh-command'
import { git_notify, type GitNotifyConfig } from './git-notify'
import {
	git_pr_followup_wrapup,
	post_notify_issue,
	type WrapupInput,
} from './git-pr-followup-wrapup'

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		issue_get_body: vi.fn(),
		issue_edit_body: vi.fn(),
		issue_comment: vi.fn(),
		pr_comment: vi.fn(),
		pr_merge: vi.fn(),
	},
}))

vi.mock('./git-epic-close', () => ({
	git_epic_close: { close_completed_epics: vi.fn() },
}))

vi.mock('./git-notify', () => ({
	git_notify: { build_completion_comment_body: vi.fn().mockReturnValue('completion body') },
}))

const NOTIFY_CONFIG: GitNotifyConfig = { target: 'issue', message: 'done', mentions: [] }
const GATEWAY_ERROR = '502 Bad Gateway'

const BASE_INPUT: WrapupInput = {
	branch_name: 'feature-branch',
	issue_number: '42',
	notify_config: NOTIFY_CONFIG,
	pr_url: 'https://github.com/owner/repo/pull/7',
	should_merge: true,
	managed_notes: [],
}

const mocked_get_body = vi.mocked(git_gh_command.issue_get_body)
const mocked_edit_body = vi.mocked(git_gh_command.issue_edit_body)
const mocked_comment = vi.mocked(git_gh_command.issue_comment)
const mocked_close_epics = vi.mocked(git_epic_close.close_completed_epics)

async function run_wrapup(input: Partial<WrapupInput>): Promise<void> {
	await git_pr_followup_wrapup.run_wrapup(
		{ ...BASE_INPUT, ...input },
		git_followup_stages.new_log(),
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	mocked_get_body.mockResolvedValue('existing content')
	mocked_comment.mockResolvedValue('')
	mocked_close_epics.mockResolvedValue()
	vi.mocked(git_gh_command.pr_merge).mockResolvedValue()
})

describe('post_notify_issue — blank body uses edit, non-blank uses comment', () => {
	const ISSUE_NUMBER = '42'
	const NOTIFY_BODY = 'Completion notification'

	it('calls issue_edit_body when issue body is blank', async () => {
		mocked_get_body.mockResolvedValue('')
		mocked_edit_body.mockResolvedValue('')

		await post_notify_issue({ issue_number: ISSUE_NUMBER, body: NOTIFY_BODY })

		expect(mocked_edit_body).toHaveBeenCalledWith(ISSUE_NUMBER, NOTIFY_BODY)
		expect(mocked_comment).not.toHaveBeenCalled()
	})

	it('calls issue_comment when issue body is non-blank', async () => {
		await post_notify_issue({ issue_number: ISSUE_NUMBER, body: NOTIFY_BODY })

		expect(mocked_comment).toHaveBeenCalledWith(ISSUE_NUMBER, NOTIFY_BODY)
		expect(mocked_edit_body).not.toHaveBeenCalled()
	})

	it('falls back to issue_comment when body fetch fails (undefined)', async () => {
		mocked_get_body.mockResolvedValue(undefined)

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

// joshuafolkken/kit#1539: the merge has landed by the time these steps run, so a failure in one of
// them is cleanup that did not finish — not a run that failed.
describe('run_wrapup — a step that fails after the merge', () => {
	const FAILURE = new Error(GATEWAY_ERROR)

	it('does not reject when the completion comment fails', async () => {
		mocked_comment.mockRejectedValue(FAILURE)

		await expect(run_wrapup({})).resolves.toBeUndefined()
	})

	it('still closes the epic after the completion comment failed', async () => {
		mocked_comment.mockRejectedValue(FAILURE)

		await run_wrapup({})

		expect(mocked_close_epics).toHaveBeenCalledOnce()
	})

	it('does not reject when the invocation carried no issue number', async () => {
		await expect(run_wrapup({ issue_number: undefined })).resolves.toBeUndefined()
	})

	it('reports the failure rather than swallowing it', async () => {
		mocked_comment.mockRejectedValue(FAILURE)

		await run_wrapup({})

		const warned = vi.mocked(console.warn).mock.calls.map(([line]) => String(line))

		expect(warned.join('\n')).toContain('The completion comment')
	})

	it('does not reject when the epic close fails', async () => {
		mocked_close_epics.mockRejectedValue(FAILURE)

		await expect(run_wrapup({})).resolves.toBeUndefined()
	})
})

// Nothing irreversible has happened before a merge, so re-running the command is the whole recovery
// and a failure there still ends the run.
describe('run_wrapup — a run that merged nothing', () => {
	it('rejects when the completion notification fails', async () => {
		mocked_comment.mockRejectedValue(new Error(GATEWAY_ERROR))

		await expect(run_wrapup({ should_merge: false })).rejects.toThrow(GATEWAY_ERROR)
	})

	it('merges nothing', async () => {
		await run_wrapup({ should_merge: false })

		expect(vi.mocked(git_gh_command.pr_merge)).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#1592. The completion report on the Issue is the managed config-file report's
// second destination. What is pinned here is the **pass-through** — that this module hands the notes
// on rather than dropping them; both destinations end to end are
// `git-pr-followup-managed-report.test.ts`, which leaves the matcher real. Reaching only one of the
// two would leave the change invisible to whichever reader used the other.
// Written the way `managed_config_scope.format_hit` writes it — path, then the list that claimed it.
const REPORT_LINE = '.claude/skills/workflow-commands/epicrun.md (AI_COPY_DIRECTORIES)'

function notes_passed(): ReadonlyArray<string> | undefined {
	return vi.mocked(git_notify.build_completion_comment_body).mock.calls[0]?.[0]?.notes
}

describe('run_wrapup — the managed config-file report', () => {
	it('hands the report to the completion comment body', async () => {
		await run_wrapup({ managed_notes: [REPORT_LINE] })

		expect(notes_passed()).toEqual([REPORT_LINE])
	})

	it('hands over an empty report unchanged, so the comment gains no section', async () => {
		await run_wrapup({ managed_notes: [] })

		expect(notes_passed()).toEqual([])
	})
})
