import { NEEDS_HUMAN_REVIEW_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { lane_review_stop } from './lane-review-stop'
import type { LaneStateRecord } from './lane-state-record'

const STOPPED = 5272
const OTHER = 7491
const STOPPED_MS = Date.parse('2026-11-21T09:00:00Z')

function record_of(issue: number, state: LaneStateRecord['state']): LaneStateRecord {
	const at = new Date(STOPPED_MS).toISOString()

	return { issue: String(issue), state, launched_at: at, changed_at: at, changed_by: 'lane:pause' }
}

describe('lane_review_stop.stops_of', () => {
	it('keeps a human-review lane with the time its record last changed', () => {
		const records = [record_of(STOPPED, 'human-review'), record_of(OTHER, 'running')]

		expect(lane_review_stop.stops_of(records)).toStrictEqual(new Map([[STOPPED, STOPPED_MS]]))
	})

	it('keeps no paused lane, as the label stands on it from before the run', () => {
		const records = [record_of(STOPPED, 'paused')]

		expect(lane_review_stop.stops_of(records)).toStrictEqual(new Map())
	})
})

describe('lane_review_stop.is_review_stop', () => {
	const stopped = new Map([[STOPPED, STOPPED_MS]])

	it('is a review stop when the label sits on an issue whose lane stopped', () => {
		expect(lane_review_stop.is_review_stop(STOPPED, [NEEDS_HUMAN_REVIEW_LABEL], stopped)).toBe(true)
	})

	it('is no review stop on the label alone, as it stands before the run', () => {
		expect(lane_review_stop.is_review_stop(OTHER, [NEEDS_HUMAN_REVIEW_LABEL], stopped)).toBe(false)
		expect(lane_review_stop.is_review_stop(STOPPED, [NEEDS_HUMAN_REVIEW_LABEL], undefined)).toBe(
			false,
		)
	})

	it('is no review stop for a stopped lane without the label', () => {
		expect(lane_review_stop.is_review_stop(STOPPED, [RUN_LANE_LABEL], stopped)).toBe(false)
	})
})
