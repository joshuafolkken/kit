import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_followup_stages } from './git-followup-stages'
import type { WrapupInput } from './git-pr-followup-wrapup'

// joshuafolkken/kit#3773: the merge is the last point a person's issue update can still change what
// ships, so `run_wrapup` checks the issue once more right before it merges. A separate suite from
// `git-pr-followup-wrapup.test.ts`, which is at its length limit.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_view_json: vi.fn(),
		issue_edit_body: vi.fn(),
		issue_comment: vi.fn(),
		pr_comment: vi.fn(),
		pr_merge: vi.fn(),
	},
}))

vi.mock('#scripts/issue/issue-watch-gate', () => ({
	issue_watch_gate: { assert_read_here: vi.fn() },
}))

vi.mock('./git-followup-label', () => ({
	git_followup_label: { strip_in_progress: vi.fn() },
}))

vi.mock('./git-followup-issue-close', () => ({
	git_followup_issue_close: { ensure_issue_closed: vi.fn(), CLOSE_RECOVERY: 'close by hand' },
}))

vi.mock('#scripts/epic/epic-close', () => ({
	epic_close: { close_completed_epics: vi.fn() },
}))

vi.mock('#scripts/notify/git-notify', () => ({
	git_notify: { build_completion_comment_body: vi.fn().mockReturnValue('completion body') },
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const { issue_watch_gate } = await import('#scripts/issue/issue-watch-gate')
const { git_pr_followup_wrapup } = await import('./git-pr-followup-wrapup')

const UNREAD_UPDATE = 'A person updated issue #42'

const BASE_INPUT: WrapupInput = {
	branch_name: 'feature-branch',
	issue_number: '42',
	closes_number: '42',
	notify_config: { target: 'issue', message: 'done', mentions: [] },
	pr_url: 'https://github.com/owner/repo/pull/7',
	should_merge: true,
	managed_notes: [],
	checked: {
		rollup: [],
		merge_state_status: 'CLEAN',
		review_decision: undefined,
		head_sha: 'c0ffee1',
	},
	wait_for_green: vi.fn(),
	send_completion: vi.fn().mockResolvedValue(undefined),
}

const mocked_merge = vi.mocked(git_gh_command.pr_merge)
const mocked_assert = vi.mocked(issue_watch_gate.assert_read_here)

async function run_wrapup(input: Partial<WrapupInput>): Promise<void> {
	await git_pr_followup_wrapup.run_wrapup(
		{ ...BASE_INPUT, ...input },
		git_followup_stages.new_log(),
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	vi.mocked(git_gh_command.issue_comment).mockResolvedValue('')
	mocked_merge.mockResolvedValue()
	mocked_assert.mockResolvedValue()
})

describe('run_wrapup — the issue check before the merge', () => {
	it('stops unmerged on an unread update', async () => {
		mocked_assert.mockRejectedValue(new Error(UNREAD_UPDATE))

		await expect(run_wrapup({ should_merge: true })).rejects.toThrow(UNREAD_UPDATE)
		expect(mocked_merge).not.toHaveBeenCalled()
	})

	it('merges after the check passes', async () => {
		await run_wrapup({ should_merge: true })

		expect(mocked_assert.mock.invocationCallOrder[0]).toBeLessThan(
			mocked_merge.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('does not check a run that merges nothing', async () => {
		await run_wrapup({ should_merge: false })

		expect(mocked_assert).not.toHaveBeenCalled()
	})

	it('does not check a pull request already merged by hand', async () => {
		await run_wrapup({ should_merge: true, is_merged: true })

		expect(mocked_assert).not.toHaveBeenCalled()
	})
})
