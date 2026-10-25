import { describe, expect, it, vi } from 'vitest'
import { review_comment_round } from './review-comment-round'
import { review_record_code_round } from './review-record-code-round'
import { review_record_comment } from './review-record-comment'

const issue_comment_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_comment: issue_comment_mock },
}))

// The real follow stamps this checkout's reviewed tree; `review-record-code-round.test.ts` owns it.
vi.mock('./review-record-code-round', () => ({
	review_record_code_round: { follow: vi.fn() },
}))

const COMMENT_URL = 'https://example.test/comment\n'
const LINE = '- rf:none | none | - | 2026-10-25 | #4907'
const ROOT = '/nonexistent/review-record-comment'
const GH_REFUSED = new Error('gh refused')
const ROUND = { issue: 4907, lines: [LINE], root: ROOT, findings: [] }

async function quietly(run: () => Promise<number>): Promise<number> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
	const code = await run()

	info.mockRestore()
	error.mockRestore()

	return code
}

describe('review_record_comment.post', () => {
	it('posts the lines as one issue comment and exits 0', async () => {
		issue_comment_mock.mockReset().mockResolvedValue(COMMENT_URL)

		expect(await quietly(async () => await review_record_comment.post(4907, [LINE]))).toBe(0)
		expect(issue_comment_mock).toHaveBeenCalledWith('4907', review_comment_round.body_of([LINE]))
	})

	it('exits 1 when the comment could not be posted, the round being recorded nowhere', async () => {
		issue_comment_mock.mockReset().mockRejectedValue(GH_REFUSED)

		expect(await quietly(async () => await review_record_comment.post(4907, [LINE]))).toBe(1)
	})
})

// joshuafolkken/kit#4907: the round recorded after the push still stamps its tree, so the ship reuses it.
describe('review_record_comment.post_after_push', () => {
	it('follows a posted round with its reviewed tree', async () => {
		issue_comment_mock.mockReset().mockResolvedValue(COMMENT_URL)
		vi.mocked(review_record_code_round.follow).mockClear()

		expect(await quietly(async () => await review_record_comment.post_after_push(ROUND))).toBe(0)
		expect(review_record_code_round.follow).toHaveBeenCalledExactlyOnceWith(4907, ROOT, [])
	})

	it('leaves a round that could not be posted unfollowed', async () => {
		issue_comment_mock.mockReset().mockRejectedValue(GH_REFUSED)
		vi.mocked(review_record_code_round.follow).mockClear()

		expect(await quietly(async () => await review_record_comment.post_after_push(ROUND))).toBe(1)
		expect(review_record_code_round.follow).not.toHaveBeenCalled()
	})
})
