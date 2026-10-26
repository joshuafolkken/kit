import { run_review_pinned_accepted } from '#scripts/run/review/run-review-pinned-accepted'
import { run_review_pinned_join } from '#scripts/run/review/run-review-pinned-join'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { check_related_pinned } from './check-related-pinned'

const ROOT = '/checkout'
const REPORT = 'unpinned 2 · unchecked 0\n  scripts/a.ts:10\n  scripts/b.ts:20\n'
const UNPINNED: PinnedSummary = { text: REPORT, unpinned: ['a', 'b'] }

function reached(summary: PinnedSummary | undefined): void {
	vi.spyOn(run_review_pinned_join, 'finished_on_tree').mockResolvedValue(summary)
}

// joshuafolkken/kit#4971: only the ship's pre-detach read the verdict, so the first ship stopped on it.
describe('check_related_pinned.notice', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('lists the unpinned places with the ship form when the verdict on this tree stops the ship', async () => {
		reached(UNPINNED)
		vi.spyOn(run_review_pinned_accepted, 'judge').mockResolvedValue({ kind: 'stop', text: REPORT })

		await expect(check_related_pinned.notice(ROOT)).resolves.toBe(
			`${REPORT.trimEnd()}\n${check_related_pinned.SHIP_HINT}`,
		)
		expect(run_review_pinned_join.finished_on_tree).toHaveBeenCalledExactlyOnceWith(ROOT)
		expect(check_related_pinned.SHIP_HINT).toContain('pnpm josh ship')
		expect(check_related_pinned.SHIP_HINT).toContain('--unpinned-ok "<reason>"')
	})

	it('prints nothing when no verdict is reached on this tree', async () => {
		reached(undefined)
		const judge = vi.spyOn(run_review_pinned_accepted, 'judge')

		await expect(check_related_pinned.notice(ROOT)).resolves.toBeUndefined()
		expect(judge).not.toHaveBeenCalled()
	})

	it('prints nothing when the verdict leaves no place unpinned', async () => {
		reached({ text: 'unpinned 0 · unchecked 0\n', unpinned: [] })

		await expect(check_related_pinned.notice(ROOT)).resolves.toBeUndefined()
	})

	it('prints nothing when a reason recorded earlier already accepts every place', async () => {
		reached(UNPINNED)
		vi.spyOn(run_review_pinned_accepted, 'judge').mockResolvedValue({
			kind: 'accepted',
			text: REPORT,
		})

		await expect(check_related_pinned.notice(ROOT)).resolves.toBeUndefined()
	})
})
