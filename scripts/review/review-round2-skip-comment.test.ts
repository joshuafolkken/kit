import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { issue_read, type IssueComment } from '#scripts/issue/issue-read'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { review_round2, type RoundTwoAnswer } from './review-round2'
import { review_round2_skip_comment } from './review-round2-skip-comment'

// joshuafolkken/kit#5286: `review:round2 --record <N>` writes the `## Round 2 skipped` comment once.

const ISSUE = 5286
const SKIP: RoundTwoAnswer = {
	verdict: review_round2.SKIPPED_VERDICT,
	code: review_round2.CODE.EMPTY,
	reason: 'the fix delta is empty',
}
const REQUIRED: RoundTwoAnswer = { ...SKIP, verdict: review_round2.REQUIRED_VERDICT }
const BODY = review_round2_skip_comment.body_of(SKIP)

function comment(body: string, is_trusted: boolean | undefined = true): IssueComment {
	return { author: 'joshuafolkken', created_at: '2026-10-28', body, is_trusted }
}

function plant(
	comments: ReadonlyArray<IssueComment> | undefined,
): MockInstance<typeof git_gh_issue_write.issue_try_comment> {
	vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue('[]')
	vi.spyOn(issue_read, 'parse_comments').mockResolvedValue(comments)

	return vi.spyOn(git_gh_issue_write, 'issue_try_comment').mockResolvedValue(true)
}

describe('review_round2_skip_comment.body_of', () => {
	it('names the arm that fired and quotes the reason line', () => {
		expect(BODY).toBe(
			'## Round 2 skipped\n\n- arm: A — the fix delta is empty\n- reason: the fix delta is empty',
		)
	})
})

describe('review_round2_skip_comment.record', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('posts nothing for a required answer', async () => {
		const post = plant([])

		expect(await review_round2_skip_comment.record(ISSUE, REQUIRED)).toBe('not-skipped')
		expect(post).not.toHaveBeenCalled()
	})

	it('posts the comment for a skip', async () => {
		const post = plant([])

		expect(await review_round2_skip_comment.record(ISSUE, SKIP)).toBe('posted')
		expect(post).toHaveBeenCalledWith(String(ISSUE), BODY)
	})

	it('posts nothing twice when a trusted comment already carries the same body', async () => {
		const post = plant([comment(`${BODY}\n`)])

		expect(await review_round2_skip_comment.record(ISSUE, SKIP)).toBe('present')
		expect(post).not.toHaveBeenCalled()
	})

	it('posts again past an untrusted copy of the body', async () => {
		plant([comment(BODY, false)])

		expect(await review_round2_skip_comment.record(ISSUE, SKIP)).toBe('posted')
	})

	it('posts nothing when the comments cannot be read', async () => {
		const post = plant(undefined)

		expect(await review_round2_skip_comment.record(ISSUE, SKIP)).toBe('unreadable')
		expect(post).not.toHaveBeenCalled()
	})

	it('reports a post that failed', async () => {
		plant([]).mockResolvedValue(false)

		expect(await review_round2_skip_comment.record(ISSUE, SKIP)).toBe('failed')
	})
})
