import { beforeEach, describe, expect, it, vi } from 'vitest'
import { review_round_reuse } from './review-round-reuse'

const { check_mock, refusal_mock, stopped_on_mock, unmoved_mock } = vi.hoisted(() => ({
	check_mock: vi.fn(),
	refusal_mock: vi.fn(),
	stopped_on_mock: vi.fn(),
	unmoved_mock: vi.fn(),
}))

vi.mock('./review-record', () => ({ review_record: { check: check_mock } }))

vi.mock('./review-reviewed-tree', () => ({
	review_reviewed_tree: { is_stopped_on: stopped_on_mock, is_unmoved_here: unmoved_mock },
}))

vi.mock('#scripts/issue/issue-watch-gate', () => ({
	issue_watch_gate: { review_refusal_here: refusal_mock },
}))

const ISSUE = 4763

describe('review_round_reuse.is_reusable', () => {
	beforeEach(() => {
		check_mock.mockReset().mockResolvedValue({ status: 'ok' })
		stopped_on_mock.mockReset().mockReturnValue(false)
		unmoved_mock.mockReset().mockResolvedValue(true)
	})

	it('reuses a recorded round while the tree holds still', async () => {
		expect(await review_round_reuse.is_reusable(ISSUE, false)).toBe(true)
	})

	it('does not reuse a recorded round once the tree moved, as after a main:merge', async () => {
		unmoved_mock.mockResolvedValue(false)

		expect(await review_round_reuse.is_reusable(ISSUE, false)).toBe(false)
	})

	it("reuses the ship's own stopped round 1 however the tree moved", async () => {
		unmoved_mock.mockResolvedValue(false)
		stopped_on_mock.mockReturnValue(true)

		expect(await review_round_reuse.is_reusable(ISSUE, false)).toBe(true)
	})

	it('never reuses a round the issue changed after', async () => {
		expect(await review_round_reuse.is_reusable(ISSUE, true)).toBe(false)
		expect(check_mock).not.toHaveBeenCalled()
	})

	it('never reuses a round that is not recorded', async () => {
		check_mock.mockResolvedValue({ status: 'missing' })

		expect(await review_round_reuse.is_reusable(ISSUE, false)).toBe(false)
	})
})

describe('review_round_reuse.is_stale_here', () => {
	it('is stale when josh followup would refuse the review', async () => {
		refusal_mock.mockResolvedValue('the issue changed after the brief')

		expect(await review_round_reuse.is_stale_here()).toBe(true)
	})

	it('is fresh when there is no refusal', async () => {
		refusal_mock.mockResolvedValue(undefined)

		expect(await review_round_reuse.is_stale_here()).toBe(false)
	})

	it('reads a refusal that could not be read as fresh, as the ship probe always has', async () => {
		refusal_mock.mockRejectedValue(new Error('gh unavailable'))

		expect(await review_round_reuse.is_stale_here()).toBe(false)
	})
})
