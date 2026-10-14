import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3773: the issue watch ends with the run it watched, so a merged run clears it
// beside the review records. A separate suite from `git-followup-finish.test.ts`, which is at its
// length limit.

const watch_clear_mock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('#scripts/issue/issue-watch', () => ({
	issue_watch: { clear_here: watch_clear_mock },
}))

vi.mock('#scripts/review/review-stamps', () => ({
	review_stamps: { clear_round_one: vi.fn() },
}))

vi.mock('#scripts/review/review-attest', () => ({
	review_attest: { clear_here: vi.fn(async () => undefined) },
}))

const { git_followup_finish } = await import('./git-followup-finish')

beforeEach(() => {
	vi.clearAllMocks()
})

describe('clear_review_records — the issue watch', () => {
	it('clears the watch on a merged run', async () => {
		await git_followup_finish.clear_review_records(true)

		expect(watch_clear_mock).toHaveBeenCalledOnce()
	})

	it('keeps the watch on a run that merged nothing', async () => {
		await git_followup_finish.clear_review_records(false)

		expect(watch_clear_mock).not.toHaveBeenCalled()
	})

	it('does not fail the tail when the clear rejects', async () => {
		watch_clear_mock.mockRejectedValue(new Error('EACCES'))

		await expect(git_followup_finish.clear_review_records(true)).resolves.toBeUndefined()
	})
})
