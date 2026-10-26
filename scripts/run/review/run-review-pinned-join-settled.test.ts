import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { run_review_pinned_join } from './run-review-pinned-join'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#4987: `check:related` ended before the probe it restarted, printed no verdict, and
// the ship's pre-detach stopped on the unpinned places instead.

const ROOT = '/checkout'
const GRACE_MS = 1000
const LAUNCHED_TREE = 'fixed-tree'
const MOVED_TREE = 'moved-tree'
const ANSWER: PinnedSummary = { text: 'unpinned 1 · unchecked 0\n', unpinned: ['a'] }

function still_now(): number {
	return 0
}

function idle(): Mock<() => Promise<void>> {
	return vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
}

async function settled(
	pause: () => Promise<void>,
	now: () => number = still_now,
): Promise<PinnedSummary | undefined> {
	return await run_review_pinned_join.settled_on_tree(ROOT, GRACE_MS, now, pause)
}

beforeEach(() => {
	vi.spyOn(run_review_pinned_steps, 'is_answered').mockReturnValue(false)
	vi.spyOn(run_review_pinned_steps, 'is_live').mockReturnValue(true)
	vi.spyOn(run_review_pinned_steps, 'launched_tree').mockReturnValue(LAUNCHED_TREE)
	vi.spyOn(run_review_pinned_steps, 'answer_now').mockReturnValue(ANSWER)
	vi.spyOn(run_review_pinned_tree, 'key').mockResolvedValue(LAUNCHED_TREE)
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('run_review_pinned_join.settled_on_tree', () => {
	it('waits for the answer the check leaves on this tree, then reads it', async () => {
		const pause = vi.fn(async (): Promise<void> => {
			vi.mocked(run_review_pinned_steps.is_answered).mockReturnValue(true)
		})

		await expect(settled(pause)).resolves.toBe(ANSWER)
		expect(pause).toHaveBeenCalledOnce()
	})

	it('reads the answer already left without waiting', async () => {
		vi.mocked(run_review_pinned_steps.is_answered).mockReturnValue(true)
		const pause = idle()

		await expect(settled(pause)).resolves.toBe(ANSWER)
		expect(pause).not.toHaveBeenCalled()
	})

	it('polls once per review poll interval by default', async () => {
		vi.useFakeTimers()
		const answer = run_review_pinned_join.settled_on_tree(ROOT, GRACE_MS * GRACE_MS)

		await vi.advanceTimersByTimeAsync(run_review_steps.POLL_INTERVAL_MS - 1)
		vi.mocked(run_review_pinned_steps.is_answered).mockReturnValue(true)
		expect(run_review_pinned_steps.answer_now).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)

		await expect(answer).resolves.toBe(ANSWER)
	})
})

describe('run_review_pinned_join.settled_on_tree — the wait ends', () => {
	it('stops waiting once the tree moves, answering none as a read without a wait does', async () => {
		const pause = vi.fn(async (): Promise<void> => {
			vi.mocked(run_review_pinned_tree.key).mockResolvedValue(MOVED_TREE)
		})

		await expect(settled(pause)).resolves.toBeUndefined()
		expect(pause).toHaveBeenCalledOnce()
	})

	it('stops waiting once the check ends without an answer', async () => {
		const pause = vi.fn(async (): Promise<void> => {
			vi.mocked(run_review_pinned_steps.is_live).mockReturnValue(false)
		})

		await expect(settled(pause)).resolves.toBeUndefined()
		expect(pause).toHaveBeenCalledOnce()
	})

	it("stops waiting once the caller's grace runs out", async () => {
		const now = vi
			.fn<() => number>()
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(0)
			.mockReturnValue(GRACE_MS)
		const pause = idle()

		await expect(settled(pause, now)).resolves.toBeUndefined()
		expect(pause).toHaveBeenCalledOnce()
	})
})
