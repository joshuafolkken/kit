import { NEEDS_HUMAN_REVIEW_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import type { LaneStateRecord } from '#scripts/lane/lane-state'
import { describe, expect, it } from 'vitest'
import type { BoardPlan } from './run-board-layout-types'
import { run_board_review_stop } from './run-board-review-stop'

const REPO = 'joshuafolkken/kit'
const STOPPED = 5272
const OTHER = 7491
const STOPPED_MS = Date.parse('2026-11-21T09:00:00Z')
const NOW_MS = Date.parse('2026-11-21T10:30:00Z')
const LANE_TAIL = '→ review the uncommitted changes in .kit-lanes/5272'

function record_of(issue: number, state: LaneStateRecord['state']): LaneStateRecord {
	const at = new Date(STOPPED_MS).toISOString()

	return { issue: String(issue), state, launched_at: at, changed_at: at, changed_by: 'lane:pause' }
}

function plan_of(review_stops?: ReadonlyMap<number, number>): BoardPlan {
	return {
		waves: { waves: [], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set() },
		labels: new Map(),
		review_stops,
		now_ms: NOW_MS,
	}
}

describe('run_board_review_stop.reason_of', () => {
	it('names the lane holding the changes and how long ago it stopped', () => {
		const plan = plan_of(new Map([[STOPPED, STOPPED_MS]]))

		expect(run_board_review_stop.reason_of(STOPPED, plan).tail).toBe(
			`${LANE_TAIL} (stopped 1°30′00″ ago)`,
		)
	})

	it('names the lane alone when no lane record says when it stopped', () => {
		expect(run_board_review_stop.reason_of(STOPPED, plan_of()).tail).toBe(LANE_TAIL)
	})
})

describe('run_board_review_stop.labelled_reason', () => {
	it('reads a review stop from its labels only', () => {
		const plan = plan_of()

		expect(
			run_board_review_stop.labelled_reason(STOPPED, [NEEDS_HUMAN_REVIEW_LABEL], plan)?.tail,
		).toBe(LANE_TAIL)
		expect(run_board_review_stop.labelled_reason(STOPPED, [RUN_LANE_LABEL], plan)).toBeUndefined()
	})
})

describe('run_board_review_stop.stops_of', () => {
	it.each(['human-review', 'paused'] as const)(
		'keeps a %s lane with the time its record last changed, and no running lane',
		(state) => {
			const records = [record_of(STOPPED, state), record_of(OTHER, 'running')]

			expect(run_board_review_stop.stops_of(records)).toStrictEqual(
				new Map([[STOPPED, STOPPED_MS]]),
			)
		},
	)
})
