import { describe, expect, it, vi } from 'vitest'
import { review_comment_carry } from './review-comment-carry'
import { review_comment_round } from './review-comment-round'

vi.mock('./review-comment-round', () => ({ review_comment_round: { carry: vi.fn() } }))

const ROOT = '/nonexistent/review-comment-carry'

async function printed_by_carry(): Promise<{ info: string; warn: string }> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

	await review_comment_carry.carry_reported(ROOT)
	const printed = {
		info: info.mock.calls.flat().join('\n'),
		warn: warn.mock.calls.flat().join('\n'),
	}

	info.mockRestore()
	warn.mockRestore()

	return printed
}

// joshuafolkken/kit#5326: `review:record` and `observations:flush` both run the carry through here.
describe('review_comment_carry.carry_reported', () => {
	it('carries into the root it is given and says how many lines', async () => {
		vi.mocked(review_comment_round.carry).mockResolvedValueOnce(3)

		const printed = await printed_by_carry()

		expect(review_comment_round.carry).toHaveBeenCalledWith(ROOT)
		expect(printed.info).toBe(`Carried 3 ${review_comment_carry.CARRIED_LINE}`)
	})

	it('prints nothing when there was nothing to carry', async () => {
		vi.mocked(review_comment_round.carry).mockResolvedValueOnce(0)

		expect(await printed_by_carry()).toEqual({ info: '', warn: '' })
	})

	it('warns rather than throwing when the carry fails', async () => {
		vi.mocked(review_comment_round.carry).mockRejectedValueOnce(new Error('gh refused'))

		const printed = await printed_by_carry()

		expect(printed.warn).toBe(`${review_comment_carry.CARRY_FAILED_LINE} gh refused`)
	})
})
