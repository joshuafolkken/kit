import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_closing_pr } from './issue-closing-pr'

// joshuafolkken/kit#5051: the issue form's default port reads the pull request that closes the issue,
// and keys the ledger exclusion on the issue itself so that pull request's own merge is no sample.

const ISSUE = 5041
const CLOSING_PR = 5049
const MERGED_AT = '2026-10-26T15:00:19Z'

vi.mock('#scripts/gh/git-gh-pr-read', () => ({
	read_pull: vi.fn(async () => ({ merged_at: MERGED_AT, body: `closes #${String(ISSUE)}` })),
}))

const { read_pull } = await import('#scripts/gh/git-gh-pr-read')
const { issue_sample_prime } = await import('./issue-sample-prime')

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_sample_prime.read_closing', () => {
	it('reads the merge of the closing pull request, closing the cited issue', async () => {
		vi.spyOn(issue_closing_pr, 'read_closing_number').mockResolvedValue(CLOSING_PR)

		expect(await issue_sample_prime.read_closing(ISSUE)).toStrictEqual({
			merged_at: MERGED_AT,
			closes: ISSUE,
		})
		expect(read_pull).toHaveBeenCalledWith(CLOSING_PR)
	})

	it('reads as unmerged when no pull request closes the issue yet', async () => {
		vi.spyOn(issue_closing_pr, 'read_closing_number').mockResolvedValue(undefined)

		expect(await issue_sample_prime.read_closing(ISSUE)).toStrictEqual({
			merged_at: undefined,
			closes: ISSUE,
		})
	})
})
