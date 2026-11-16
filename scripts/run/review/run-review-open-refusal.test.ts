import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_open_refusal } from './run-review-open-refusal'

const { branch, grown, handed_over, unplanned } = vi.hoisted(() => ({
	branch: vi.fn<() => Promise<string>>(),
	grown: vi.fn<(directory: string, accept_reason?: string) => Promise<string | undefined>>(),
	handed_over: vi.fn<(issue: number) => Promise<boolean>>(),
	unplanned: vi.fn<() => Promise<string | undefined>>(),
}))

vi.mock('#scripts/git/git-command', () => ({ git_command: { branch } }))
vi.mock('#scripts/gate/metrics-totals', () => ({ metrics_totals: { totals_refusal: grown } }))
vi.mock('#scripts/review/review-lane-handover', () => ({
	review_lane_handover: {
		is_reopen_refused: handed_over,
		refusal: (issue: number) => `HANDED OVER #${String(issue)}`,
	},
}))
vi.mock('./run-review-unplanned', () => ({ run_review_unplanned: { refusal: unplanned } }))

const HANDOVER = 'HANDED OVER #7598'
const METRICS = 'METRICS GROWN'
const UNPLANNED = 'UNPLANNED FILE'

beforeEach(() => {
	branch.mockResolvedValue('7598-lane')
	handed_over.mockResolvedValue(false)
	grown.mockResolvedValue(undefined)
	unplanned.mockResolvedValue(undefined)
})

describe('run_review_open_refusal.refusal', () => {
	it('refuses nothing when no stop applies', async () => {
		await expect(run_review_open_refusal.refusal(false)).resolves.toBeUndefined()
	})

	it('answers the handover first, ahead of the metrics and unplanned stops', async () => {
		handed_over.mockResolvedValue(true)
		grown.mockResolvedValue(METRICS)
		unplanned.mockResolvedValue(UNPLANNED)

		await expect(run_review_open_refusal.refusal(false)).resolves.toBe(HANDOVER)
	})

	it('answers the metrics stop ahead of the unplanned one', async () => {
		grown.mockResolvedValue(METRICS)
		unplanned.mockResolvedValue(UNPLANNED)

		await expect(run_review_open_refusal.refusal(false)).resolves.toBe(METRICS)
	})

	it('answers the unplanned stop when it is the only one', async () => {
		unplanned.mockResolvedValue(UNPLANNED)

		await expect(run_review_open_refusal.refusal(false)).resolves.toBe(UNPLANNED)
	})

	it('skips the handover on a branch that names no issue', async () => {
		branch.mockResolvedValue('main')
		handed_over.mockResolvedValue(true)

		await expect(run_review_open_refusal.refusal(false)).resolves.toBeUndefined()
		expect(handed_over).not.toHaveBeenCalled()
	})

	it("never refuses the ship's own --code-only open", async () => {
		handed_over.mockResolvedValue(true)
		grown.mockResolvedValue(METRICS)
		unplanned.mockResolvedValue(UNPLANNED)

		await expect(run_review_open_refusal.refusal(true)).resolves.toBeUndefined()
		expect(branch).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#7599: `--accept-metrics` reaches the totals' judgment, which records the growth.
describe('run_review_open_refusal.refusal — --accept-metrics', () => {
	it('hands the reason to the totals judgment', async () => {
		const reason = 'a new command'

		await run_review_open_refusal.refusal(false, reason)

		expect(grown).toHaveBeenCalledWith(expect.any(String), reason)
	})
})
