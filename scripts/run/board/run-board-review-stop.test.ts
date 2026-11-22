import path from 'node:path'
import { NEEDS_HUMAN_REVIEW_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import type { LaneStateRecord } from '#scripts/lane/lane-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardPlan, ReviewStop } from './run-board-layout-types'
import { run_board_review_stop } from './run-board-review-stop'

const REPO = 'joshuafolkken/kit'
const REPOSITORY = '/work/kit'
const LANE_ROOT = '/lanes'
const STOPPED = 5272
const OTHER = 7491
const STOPPED_MS = Date.parse('2026-11-21T09:00:00Z')
const NOW_MS = Date.parse('2026-11-21T10:30:00Z')
const DIRECTORY = '/work/.kit-lanes/5272'

function record_of(issue: number, state: LaneStateRecord['state']): LaneStateRecord {
	const at = new Date(STOPPED_MS).toISOString()

	return { issue: String(issue), state, launched_at: at, changed_at: at, changed_by: 'lane:pause' }
}

function plan_of(review_stops?: ReadonlyMap<number, ReviewStop>): BoardPlan {
	return {
		waves: { waves: [], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set() },
		labels: new Map(),
		review_stops,
		now_ms: NOW_MS,
	}
}

const STOPPED_RECORD = record_of(STOPPED, 'human-review')
const STOPS = new Map([[STOPPED, { stopped_ms: STOPPED_MS, directory: DIRECTORY }]])

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_review_stop.stops_here', () => {
	it('keeps each stopped lane with its directory under the lane root beside the repository', () => {
		vi.stubEnv('JOSH_LANE_ROOT', '')
		const records = [STOPPED_RECORD, record_of(OTHER, 'running')]

		expect(run_board_review_stop.stops_here(records, REPOSITORY)).toStrictEqual(STOPS)
	})

	it('names the directory under the configured lane root', () => {
		vi.stubEnv('JOSH_LANE_ROOT', LANE_ROOT)
		const stops = run_board_review_stop.stops_here([STOPPED_RECORD], REPOSITORY)

		expect(stops.get(STOPPED)?.directory).toBe(path.join(LANE_ROOT, String(STOPPED)))
	})
})

describe('run_board_review_stop.reason_of', () => {
	it('names the lane holding the changes and how long ago it stopped', () => {
		const child = { number: STOPPED, labels: [NEEDS_HUMAN_REVIEW_LABEL] }

		expect(run_board_review_stop.reason_of(child, plan_of(STOPS))?.tail).toBe(
			`→ review the uncommitted changes in ${DIRECTORY} (stopped 1°30′00″ ago)`,
		)
	})

	it('says nothing for the label alone, as it stands before the run', () => {
		const child = { number: STOPPED, labels: [NEEDS_HUMAN_REVIEW_LABEL] }

		expect(run_board_review_stop.reason_of(child, plan_of())).toBeUndefined()
	})

	it('says nothing for a stopped lane without the label', () => {
		const child = { number: STOPPED, labels: [RUN_LANE_LABEL] }

		expect(run_board_review_stop.reason_of(child, plan_of(STOPS))).toBeUndefined()
	})
})
