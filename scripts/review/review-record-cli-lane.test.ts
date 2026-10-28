import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { review_comment_round } from './review-comment-round'
import { review_record_cli } from './review-record-cli'

// A round is appended in memory, and the closed issues' carry reads no GitHub.
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

const NOW = new Date('2026-10-28T00:00:00Z')
const ROOT = '/nonexistent/review-record-cli-lane'
const ARGV = ['--issue', '5326', '--interaction']

async function printed_by_record(): Promise<string> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	await review_record_cli.run(ARGV, NOW, ROOT)
	const printed = info.mock.calls.flat().join('\n')

	info.mockRestore()

	return printed
}

// joshuafolkken/kit#5326: parallel lanes each wrote the same closed issue's carried file and waited
// and conflicted on it, so `observations:flush` carries for them.
describe('review_record_cli.run — the comment-round carry in a lane child', () => {
	beforeEach(() => {
		vi.mocked(review_comment_round.carry).mockClear()
	})

	it('records the round, carries nothing, and names observations:flush', async () => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValueOnce(true)

		const printed = await printed_by_record()

		expect(observation_ledger_home.append).toHaveBeenCalled()
		expect(review_comment_round.carry).not.toHaveBeenCalled()
		expect(printed).toContain('pnpm josh observations:flush')
	})

	it('carries into the checkout outside a lane', async () => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValueOnce(false)

		await printed_by_record()

		expect(review_comment_round.carry).toHaveBeenCalledExactlyOnceWith(ROOT)
	})
})
