import { gate_skip } from '#scripts/gate/gate-skip'
import { gate_tree } from '#scripts/gate/gate-tree'
import { run_ship_planned } from '#scripts/run/ship/run-ship-planned'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_join_ready } from './run-review-join-ready'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'

const TREE = { files: Object.fromEntries([['scripts/example.ts', 'digest']]), base: 'base' }
const SUMMARY = { text: 'All pinned\n', unpinned: [] }
const KEY = 'same-tree'

beforeEach(() => {
	vi.spyOn(run_review_pinned_steps, 'is_answered').mockReturnValue(true)
	vi.spyOn(run_review_pinned_steps, 'launched_tree').mockReturnValue(KEY)
	vi.spyOn(run_review_pinned_steps, 'answer_now').mockReturnValue(SUMMARY)
	vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue(TREE)
	vi.spyOn(run_review_pinned_tree, 'digest_of').mockReturnValue(KEY)
	vi.spyOn(run_review_pinned_tree, 'key').mockResolvedValue(KEY)
	vi.spyOn(gate_skip, 'reusable_green_gate').mockReturnValue({ taken_at: 'now', files: TREE.files })
	vi.spyOn(run_ship_planned, 'unplanned').mockResolvedValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_review_join_ready.read', () => {
	it('reuses a complete answer only with the gate green on the same tree', async () => {
		expect(await run_review_join_ready.read()).toBe(SUMMARY)
		expect(gate_skip.reusable_green_gate).toHaveBeenCalledWith(TREE.files, TREE.base)
	})

	it('leaves an unfinished pinned check to the normal join', async () => {
		vi.mocked(run_review_pinned_steps.is_answered).mockReturnValue(false)

		expect(await run_review_join_ready.read()).toBeUndefined()
		expect(gate_tree.read_gate_tree).not.toHaveBeenCalled()
	})

	it('leaves a missing or red gate to the normal join', async () => {
		vi.mocked(gate_skip.reusable_green_gate).mockReturnValue(undefined)

		expect(await run_review_join_ready.read()).toBeUndefined()
	})
})

describe('run_review_join_ready incomplete answers', () => {
	it.each([
		{ unpinned: ['site'] },
		{ is_partial: true },
		{ is_cut: true },
		{ is_unchecked: true },
		{ remaining: 1 },
	])('leaves an incomplete or unpinned answer to the normal join: %j', async (extra) => {
		vi.mocked(run_review_pinned_steps.answer_now).mockReturnValue({ ...SUMMARY, ...extra })

		expect(await run_review_join_ready.read()).toBeUndefined()
	})

	it('rejects a check launched on another tree', async () => {
		vi.mocked(run_review_pinned_steps.launched_tree).mockReturnValue('old-tree')

		expect(await run_review_join_ready.read()).toBeUndefined()
	})
})

describe('run_review_join_ready changing or unread state', () => {
	it('rejects a tree that moves while reading the answers', async () => {
		vi.mocked(run_review_pinned_tree.key).mockResolvedValue('moved-tree')

		expect(await run_review_join_ready.read()).toBeUndefined()
	})

	it('rejects an unread tree', async () => {
		vi.mocked(run_review_pinned_tree.digest_of).mockReturnValue(undefined)

		expect(await run_review_join_ready.read()).toBeUndefined()
	})

	it('leaves an unplanned file to the normal join and its notice', async () => {
		vi.mocked(run_ship_planned.unplanned).mockResolvedValue({
			issue: 6245,
			files: ['scripts/extra.ts'],
			text: 'unplanned',
		})

		expect(await run_review_join_ready.read()).toBeUndefined()
	})

	it('treats a failed unplanned read as unsettled', async () => {
		vi.mocked(run_ship_planned.unplanned).mockRejectedValue(new Error('unread'))

		expect(await run_review_join_ready.read()).toBeUndefined()
	})
})
