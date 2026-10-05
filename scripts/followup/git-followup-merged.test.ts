import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_followup_merged } from './git-followup-merged'

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		pr_get_merge_state: vi.fn(),
		issue_list_comments: vi.fn(),
	},
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')

const PR_URL = 'https://github.com/owner/repo/pull/7'
const OTHER_PR_URL = 'https://github.com/owner/repo/pull/8'
const ISSUE = '3023'
const BRANCH = '3023-lane'
const HEAD_SHA = 'abc123'
const MERGED_AT = '2026-10-04T12:00:00Z'
const BEFORE_MERGE = '2026-10-04T11:00:00Z'
const AFTER_MERGE = '2026-10-04T13:00:00Z'

function report(pr_url: string): string {
	return `✅ Implemented the change\nIssue: #${ISSUE}\nPR: ${pr_url}`
}

function comments(...rows: ReadonlyArray<{ body: string; created_at?: string }>): string {
	return JSON.stringify(rows.map((row) => ({ created_at: AFTER_MERGE, ...row })))
}

function record(comments_json: string | undefined): {
	comments_json: string | undefined
	pr_url: string
	merged_at: string
} {
	return { comments_json, pr_url: PR_URL, merged_at: MERGED_AT }
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('git_followup_merged.to_merge_plan — what a run does about the merge', () => {
	it('runs the tail as merged for a pull request a person already merged', () => {
		const state = {
			is_merged: true,
			merged_at: MERGED_AT,
			head_sha: HEAD_SHA,
			merge_state_status: undefined,
		}

		expect(git_followup_merged.to_merge_plan(state, false)).toStrictEqual({
			is_merged: true,
			should_merge: true,
			merged_at: MERGED_AT,
		})
	})

	it('keeps the requested merge on an open pull request', () => {
		const state = {
			is_merged: false,
			merged_at: undefined,
			head_sha: HEAD_SHA,
			merge_state_status: undefined,
		}

		expect(git_followup_merged.to_merge_plan(state, true)).toStrictEqual({
			is_merged: false,
			should_merge: true,
			merged_at: undefined,
		})
	})

	it('keeps --no-merge where the pull request could not be read', () => {
		expect(git_followup_merged.to_merge_plan(undefined, false)).toStrictEqual({
			is_merged: false,
			should_merge: false,
			merged_at: undefined,
		})
	})
})

describe('git_followup_merged.read_merge_plan — the pull request is asked, not assumed', () => {
	it('reads the merge state of the branch pull request', async () => {
		vi.mocked(git_gh_command.pr_get_merge_state).mockResolvedValue({
			is_merged: true,
			merged_at: MERGED_AT,
			head_sha: HEAD_SHA,
			merge_state_status: undefined,
		})

		await expect(git_followup_merged.read_merge_plan(BRANCH, false)).resolves.toStrictEqual({
			is_merged: true,
			should_merge: true,
			merged_at: MERGED_AT,
		})
		expect(git_gh_command.pr_get_merge_state).toHaveBeenCalledWith(BRANCH)
	})
})

describe('git_followup_merged.has_completion_record — the tail already ran', () => {
	it('finds the report in a comment naming this pull request, posted since the merge', () => {
		const json = comments({ body: 'hi' }, { body: report(PR_URL) })

		expect(git_followup_merged.has_completion_record(record(json))).toBe(true)
	})

	it('does not count the report the prrun stop posted before the merge', () => {
		const json = comments({ body: report(PR_URL), created_at: BEFORE_MERGE })

		expect(git_followup_merged.has_completion_record(record(json))).toBe(false)
	})

	it('does not count a report for another pull request', () => {
		const json = comments({ body: report(OTHER_PR_URL) })

		expect(git_followup_merged.has_completion_record(record(json))).toBe(false)
	})

	it('does not count a comment that only quotes the pull request URL', () => {
		const json = comments({ body: `see PR: ${PR_URL}` })

		expect(git_followup_merged.has_completion_record(record(json))).toBe(false)
	})

	it('reads an unreadable comment listing as no record', () => {
		expect(git_followup_merged.has_completion_record(record(undefined))).toBe(false)
	})
})

describe('git_followup_merged.is_completion_recorded — asked only on a merged pull request', () => {
	it('answers true when the merged issue already carries the report', async () => {
		vi.mocked(git_gh_command.issue_list_comments).mockResolvedValue(
			comments({ body: report(PR_URL) }),
		)
		const input = { merged_at: MERGED_AT, issue_number: ISSUE, pr_url: PR_URL }

		await expect(git_followup_merged.is_completion_recorded(input)).resolves.toBe(true)
	})

	it('reads nothing for a pull request that has not merged', async () => {
		const input = { merged_at: undefined, issue_number: ISSUE, pr_url: PR_URL }

		await expect(git_followup_merged.is_completion_recorded(input)).resolves.toBe(false)
		expect(git_gh_command.issue_list_comments).not.toHaveBeenCalled()
	})

	it('answers false when the run has no issue to read', async () => {
		const input = { merged_at: MERGED_AT, issue_number: undefined, pr_url: PR_URL }

		await expect(git_followup_merged.is_completion_recorded(input)).resolves.toBe(false)
	})
})
