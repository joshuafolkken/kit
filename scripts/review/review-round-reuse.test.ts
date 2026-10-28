import { beforeEach, describe, expect, it, vi } from 'vitest'
import { review_round_reuse } from './review-round-reuse'

const { check_mock, refusal_mock, stopped_on_mock, movement_mock } = vi.hoisted(() => ({
	check_mock: vi.fn(),
	refusal_mock: vi.fn(),
	stopped_on_mock: vi.fn(),
	movement_mock: vi.fn(),
}))

vi.mock('./review-record', () => ({ review_record: { check: check_mock } }))

vi.mock('./review-reviewed-tree', () => ({
	review_reviewed_tree: {
		MOVEMENT: { DELTA: 'delta', HELD: 'held', UNSETTLED: 'unsettled' },
		is_stopped_on: stopped_on_mock,
		standing_here: movement_mock,
	},
}))

vi.mock('#scripts/issue/issue-watch-gate', () => ({
	issue_watch_gate: { review_refusal_here: refusal_mock },
}))

const ISSUE = 4763
const REFUSAL = 'the issue changed after the brief'
const { REUSE } = review_round_reuse

describe('review_round_reuse.is_reusable', () => {
	beforeEach(() => {
		check_mock.mockReset().mockResolvedValue({ status: 'ok' })
		stopped_on_mock.mockReset().mockReturnValue(false)
		movement_mock.mockReset().mockResolvedValue({ movement: 'held' })
	})

	it('reuses a recorded round while the tree holds still', async () => {
		expect(await review_round_reuse.is_reusable(ISSUE, false)).toBe(true)
	})

	// joshuafolkken/kit#4878: round 2 reads the moved files; round 1 is not run twice.
	it('reuses a recorded round once only files round 2 reads moved', async () => {
		movement_mock.mockResolvedValue({ movement: 'delta' })

		expect(await review_round_reuse.is_reusable(ISSUE, false)).toBe(true)
	})

	it('does not reuse a recorded round once a move round 2 would not read', async () => {
		movement_mock.mockResolvedValue({ movement: 'unsettled' })

		expect(await review_round_reuse.is_reusable(ISSUE, false)).toBe(false)
	})

	it("reuses the ship's own stopped round 1 however the tree moved", async () => {
		movement_mock.mockResolvedValue({ movement: 'unsettled' })
		stopped_on_mock.mockReturnValue(true)

		expect(await review_round_reuse.is_reusable(ISSUE, false)).toBe(true)
	})

	it('never reuses a round the issue changed after', async () => {
		movement_mock.mockResolvedValue({ movement: 'delta' })

		expect(await review_round_reuse.is_reusable(ISSUE, true)).toBe(false)
		expect(check_mock).not.toHaveBeenCalled()
	})

	it('never reuses a round that is not recorded', async () => {
		check_mock.mockResolvedValue({ status: 'missing' })

		expect(await review_round_reuse.is_reusable(ISSUE, false)).toBe(false)
	})
})

describe('review_round_reuse.reuse_here', () => {
	beforeEach(() => {
		check_mock.mockReset().mockResolvedValue({ status: 'ok' })
		stopped_on_mock.mockReset().mockReturnValue(false)
		refusal_mock.mockReset().mockResolvedValue(undefined)
	})

	it.each([
		['held', false, REUSE.HELD],
		['delta', false, REUSE.DELTA],
		['unsettled', true, REUSE.DELTA],
		['unsettled', false, REUSE.AGAIN],
	])(
		'answers the ship outcome on a %s tree (stopped: %s)',
		async (movement, is_stopped, expected) => {
			movement_mock.mockResolvedValue({ movement })
			stopped_on_mock.mockReturnValue(is_stopped)

			expect(await review_round_reuse.reuse_here(ISSUE)).toBe(expected)
		},
	)

	it('answers again on a stale issue whatever moved', async () => {
		movement_mock.mockResolvedValue({ movement: 'delta' })
		refusal_mock.mockResolvedValue(REFUSAL)

		expect(await review_round_reuse.reuse_here(ISSUE)).toBe(REUSE.AGAIN)
	})
})

// joshuafolkken/kit#4941: `review:record --check` prints the cause of `again`, not every condition.
describe('review_round_reuse.answer_here — the cause', () => {
	const MOVE_CAUSE = 'docs/a.md moved where round 2 does not read'

	beforeEach(() => {
		check_mock.mockReset().mockResolvedValue({ status: 'ok' })
		stopped_on_mock.mockReset().mockReturnValue(false)
		refusal_mock.mockReset().mockResolvedValue(undefined)
		movement_mock.mockReset().mockResolvedValue({ movement: 'held' })
	})

	it('names the stale issue', async () => {
		refusal_mock.mockResolvedValue(REFUSAL)

		expect(await review_round_reuse.answer_here(ISSUE)).toStrictEqual({
			reuse: REUSE.AGAIN,
			cause: "the issue changed after the recorded round's brief",
		})
	})

	it('names a round that is not recorded', async () => {
		check_mock.mockResolvedValue({ status: 'missing' })

		expect(await review_round_reuse.answer_here(ISSUE)).toStrictEqual({
			reuse: REUSE.AGAIN,
			cause: 'no review round is recorded for this issue',
		})
	})

	it('passes the cause of an unsettled tree through', async () => {
		movement_mock.mockResolvedValue({ movement: 'unsettled', cause: MOVE_CAUSE })

		expect(await review_round_reuse.answer_here(ISSUE)).toStrictEqual({
			reuse: REUSE.AGAIN,
			cause: MOVE_CAUSE,
		})
	})

	it('carries no cause on a reused round', async () => {
		expect(await review_round_reuse.answer_here(ISSUE)).toStrictEqual({ reuse: REUSE.HELD })
	})
})

describe('review_round_reuse.is_stale_here', () => {
	it('is stale when josh followup would refuse the review', async () => {
		refusal_mock.mockResolvedValue(REFUSAL)

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

describe('review_round_reuse.is_reusable_here', () => {
	beforeEach(() => {
		check_mock.mockReset().mockResolvedValue({ status: 'ok' })
		stopped_on_mock.mockReset().mockReturnValue(true)
		movement_mock.mockReset().mockResolvedValue({ movement: 'held' })
	})

	it('reuses a recorded round on a fresh issue', async () => {
		refusal_mock.mockResolvedValue(undefined)

		expect(await review_round_reuse.is_reusable_here(ISSUE)).toBe(true)
	})

	it('reads the staleness here, so a round the issue changed after is not reused', async () => {
		refusal_mock.mockResolvedValue(REFUSAL)

		expect(await review_round_reuse.is_reusable_here(ISSUE)).toBe(false)
	})
})
