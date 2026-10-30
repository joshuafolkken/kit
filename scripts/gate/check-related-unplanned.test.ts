import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { error_text } from '#scripts/lib/error-message'
import { run_ship_planned, type Unplanned } from '#scripts/run/ship/run-ship-planned'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { check_related_unplanned } from './check-related-unplanned'

const FOUND: Unplanned = {
	issue: 5168,
	files: ['scripts/lane/lane-ledger.ts'],
	text: 'unplanned: scripts/lane/lane-ledger.ts — the lane plan misses it',
}

// joshuafolkken/kit#5203: the ship's `unplanned` answer reached the lane only at the ship's preflight,
// after the review and its fixes.
describe('check_related_unplanned.notice', () => {
	beforeEach(() => {
		vi.spyOn(lane_ledger_write, 'record_unplanned_notice').mockResolvedValue()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('returns the preflight answer and records the issue with its unplanned files', async () => {
		vi.spyOn(run_ship_planned, 'unplanned').mockResolvedValue(FOUND)

		await expect(check_related_unplanned.notice()).resolves.toBe(FOUND.text)
		expect(lane_ledger_write.record_unplanned_notice).toHaveBeenCalledExactlyOnceWith({
			issue: FOUND.issue,
			files: FOUND.files,
		})
	})

	it('returns nothing and records nothing where the preflight finds nothing unplanned', async () => {
		vi.spyOn(run_ship_planned, 'unplanned').mockResolvedValue(undefined)

		await expect(check_related_unplanned.notice()).resolves.toBeUndefined()
		expect(lane_ledger_write.record_unplanned_notice).not.toHaveBeenCalled()
	})

	it('returns nothing and records nothing when the git read rejects, so the verdict still prints', async () => {
		vi.spyOn(run_ship_planned, 'unplanned').mockRejectedValue(new Error('unborn HEAD'))
		vi.spyOn(error_text, 'trace_swallowed').mockReturnValue(undefined)

		await expect(check_related_unplanned.notice()).resolves.toBeUndefined()
		expect(error_text.trace_swallowed).toHaveBeenCalledOnce()
		expect(lane_ledger_write.record_unplanned_notice).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#5388: the join prints the notice `check:related` prints.
describe('check_related_unplanned.show', () => {
	beforeEach(() => {
		vi.spyOn(lane_ledger_write, 'record_unplanned_notice').mockResolvedValue()
		vi.spyOn(console, 'info').mockReturnValue(undefined)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("prints the preflight's answer, its lane:plan command included", async () => {
		vi.spyOn(run_ship_planned, 'unplanned').mockResolvedValue(FOUND)

		await check_related_unplanned.show()

		expect(console.info).toHaveBeenCalledExactlyOnceWith(FOUND.text)
	})

	it('prints nothing where the preflight finds nothing unplanned', async () => {
		vi.spyOn(run_ship_planned, 'unplanned').mockResolvedValue(undefined)

		await check_related_unplanned.show()

		expect(console.info).not.toHaveBeenCalled()
	})
})
