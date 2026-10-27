import { randomUUID } from 'node:crypto'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_join_read } from './run-review-join-read'
import { run_review_pinned_accepted } from './run-review-pinned-accepted'
import { run_review_pinned_join } from './run-review-pinned-join'
import { run_review_pinned_steps } from './run-review-pinned-steps'

// joshuafolkken/kit#5212: a lane that skipped `run:review --join` met its unpinned places only at the
// ship's pre-detach. The pair marks the join due, and the one read `--join` and `review:record` share
// clears it.

const STOP_TEXT = 'unpinned a.ts:3 — no test turns red\n'
const SUMMARY: PinnedSummary = { text: STOP_TEXT, unpinned: ['a.ts f'] }

// A root no other run keys its stamp to.
const root = `/checkout-${randomUUID()}`

beforeEach(() => {
	vi.spyOn(run_review_pinned_steps, 'launched_reason').mockReturnValue(undefined)
	vi.spyOn(run_review_pinned_join, 'wait_for_join').mockResolvedValue(SUMMARY)
	vi.spyOn(run_review_pinned_accepted, 'judge').mockResolvedValue({ kind: 'stop', text: STOP_TEXT })
})

afterEach(async () => {
	await run_review_join_read.read(root)
	vi.restoreAllMocks()
})

describe('run_review_join_read due mark', () => {
	it('is not due before the pair marks it', () => {
		expect(run_review_join_read.is_due(root)).toBe(false)
	})

	it('is due once marked, and the read clears it', async () => {
		run_review_join_read.mark_due(root)

		expect(run_review_join_read.is_due(root)).toBe(true)

		await run_review_join_read.read(root)

		expect(run_review_join_read.is_due(root)).toBe(false)
	})

	it("reads the current tree's answer through the join's own wait", async () => {
		await run_review_join_read.read(root, true)

		expect(run_review_pinned_join.wait_for_join).toHaveBeenCalledWith(root, undefined, true)
	})

	it("clears the mark on a read through the caller's own wait", async () => {
		run_review_join_read.mark_due(root)

		await expect(run_review_join_read.read_with(async () => SUMMARY, root)).resolves.toStrictEqual({
			summary: SUMMARY,
			is_stop: true,
			text: STOP_TEXT,
		})
		expect(run_review_join_read.is_due(root)).toBe(false)
	})
})

describe('run_review_join_read.read_finished', () => {
	it('reads only the answer already left on this tree, never waiting', async () => {
		vi.spyOn(run_review_pinned_join, 'finished_on_tree').mockResolvedValue(SUMMARY)
		run_review_join_read.mark_due(root)

		await run_review_join_read.read_finished(root)

		expect(run_review_pinned_join.finished_on_tree).toHaveBeenCalledWith(root)
		expect(run_review_pinned_join.wait_for_join).not.toHaveBeenCalled()
		expect(run_review_join_read.is_due(root)).toBe(false)
	})
})

describe('run_review_join_read.verdict', () => {
	it('stops on unpinned places judged with no reason', async () => {
		const joined = await run_review_join_read.verdict(async () => SUMMARY)

		expect(joined).toStrictEqual({ summary: SUMMARY, is_stop: true, text: STOP_TEXT })
	})

	it('answers nothing where no check was launched', async () => {
		await expect(run_review_join_read.verdict(async () => undefined)).resolves.toBeUndefined()
	})

	it('shows a partial answer without judging or stopping on it', async () => {
		const partial = { ...SUMMARY, is_partial: true }
		const joined = await run_review_join_read.verdict(async () => partial)

		expect(joined?.is_stop).toBe(false)
		expect(run_review_pinned_accepted.judge).not.toHaveBeenCalled()
	})
})
