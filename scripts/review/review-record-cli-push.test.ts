import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { describe, expect, it, vi } from 'vitest'
import type { review_comment_round } from './review-comment-round'
import { review_record_cli } from './review-record-cli'
import { review_record_comment } from './review-record-comment'

// A ledger round is appended in memory, and the closed issues' carry reads no GitHub.
vi.mock('#scripts/observations/observation-ledger-home', async (original) => {
	const actual = await original<{ observation_ledger_home: typeof observation_ledger_home }>()

	return { observation_ledger_home: { ...actual.observation_ledger_home, append: vi.fn() } }
})
vi.mock('./review-comment-round', async (original) => {
	const actual = await original<{ review_comment_round: typeof review_comment_round }>()

	return {
		review_comment_round: { ...actual.review_comment_round, carry: vi.fn().mockResolvedValue(0) },
	}
})

// joshuafolkken/kit#4907: `josh run:review` pushed at the first green gate, so a code round recorded
// on a pushed, clean tree goes to the issue unasked rather than to a ledger line needing its own push.
vi.mock('./review-record-comment', () => ({
	review_record_comment: {
		is_after_push: vi.fn().mockResolvedValue(true),
		post: vi.fn().mockResolvedValue(0),
		post_after_push: vi.fn().mockResolvedValue(0),
	},
}))

const NOW = new Date('2026-10-25T00:00:00Z')
const ROOT = '/nonexistent/review-record-cli-push'

describe('review_record_cli.run — after the push', () => {
	it('hands a code round on a pushed, clean tree to the issue comment', async () => {
		const code = await review_record_cli.run(['--issue', '4907'], NOW, ROOT)

		expect(code).toBe(0)
		expect(review_record_comment.post_after_push).toHaveBeenCalledExactlyOnceWith({
			issue: 4907,
			lines: ['- rf:none | none | - | 2026-10-25 | #4907'],
			root: ROOT,
			findings: [],
		})
	})

	// The interaction pass is read from the ledger only (`review-interaction.ts`).
	it('keeps an interaction round off the issue comment', async () => {
		vi.mocked(review_record_comment.post_after_push).mockClear()

		await review_record_cli.run(['--issue', '4907', '--interaction'], NOW, ROOT)

		expect(observation_ledger_home.append).toHaveBeenCalledOnce()
		expect(review_record_comment.post_after_push).not.toHaveBeenCalled()
	})

	it('keeps an explicit --comment round on the plain comment path', async () => {
		vi.mocked(review_record_comment.post_after_push).mockClear()

		await review_record_cli.run(['--issue', '4907', '--comment'], NOW, ROOT)

		expect(review_record_comment.post).toHaveBeenCalledOnce()
		expect(review_record_comment.post_after_push).not.toHaveBeenCalled()
	})
})
