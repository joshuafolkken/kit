import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Finding } from './review-finding-ledger'
import { review_lane_handover } from './review-lane-handover'
import { review_record_code_round } from './review-record-code-round'
import { review_record_interaction } from './review-record-interaction'
import { review_record_pinned } from './review-record-pinned'
import { review_reviewed_tree } from './review-reviewed-tree'

// joshuafolkken/kit#4834: a recorded code round records its tree, names the ship next for a lane child,
// names a due interaction pass, and starts test:pinned again on a tree its fixes moved — in that order,
// each over the same checkout. Only a lane child's round the ship reuses restarts the check.

const ISSUE = 4834
const ROOT = '/checkout'

// Each step pushes its name as it runs, so the order the round follows them in can be read back.
function spy_steps(order: Array<string>, is_handed_over: boolean): void {
	vi.spyOn(review_reviewed_tree, 'record').mockImplementation(async () => {
		order.push('tree')
	})
	vi.spyOn(review_lane_handover, 'is_handed_over').mockImplementation(async () => {
		order.push('handover')

		return is_handed_over
	})
	vi.spyOn(review_record_interaction, 'report_due').mockImplementation(async () => {
		order.push('interaction')
	})
	vi.spyOn(review_record_pinned, 'restart_if_moved').mockImplementation(async () => {
		order.push('pinned')

		return true
	})
}

beforeEach(() => {
	vi.spyOn(run_ship_detach, 'is_supervised').mockReturnValue(false)
	vi.spyOn(console, 'info').mockReturnValue()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('review_record_code_round.follow', () => {
	it('records the tree with the High-cited files unsettled, then the handover, the due pass and the restart', async () => {
		const order: Array<string> = []

		spy_steps(order, true)
		const findings: ReadonlyArray<Finding> = [
			{ category: 'bug-risks', severity: 'high', file: 'a.ts:12' },
			{ category: 'bug-risks', severity: 'medium', file: 'b.ts' },
		]

		await review_record_code_round.follow(ISSUE, ROOT, findings)

		expect(review_reviewed_tree.record).toHaveBeenCalledWith(['a.ts:12'])
		expect(review_lane_handover.is_handed_over).toHaveBeenCalledWith(ISSUE)
		expect(console.info).toHaveBeenCalledWith(review_lane_handover.NEXT_STEP_LINE)
		expect(review_record_interaction.report_due).toHaveBeenCalledWith(ISSUE, ROOT)
		expect(review_record_pinned.restart_if_moved).toHaveBeenCalledWith(ROOT)
		expect(order).toStrictEqual(['tree', 'handover', 'interaction', 'pinned'])
	})

	it('starts no check for a round the ship does not reuse from a lane child', async () => {
		const order: Array<string> = []

		spy_steps(order, false)

		await review_record_code_round.follow(ISSUE, ROOT, [])

		expect(console.info).not.toHaveBeenCalled()
		expect(order).toStrictEqual(['tree', 'handover', 'interaction'])
	})

	it("starts no check for a round recorded under the ship's supervisor", async () => {
		const order: Array<string> = []

		spy_steps(order, true)
		vi.mocked(run_ship_detach.is_supervised).mockReturnValue(true)

		await review_record_code_round.follow(ISSUE, ROOT, [])

		expect(order).toStrictEqual(['tree', 'handover', 'interaction'])
	})
})
