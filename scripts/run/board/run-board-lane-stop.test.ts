import {
	ALREADY_DONE_LABEL,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
	RUN_STALLED_LABEL,
} from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_lane_state } from './run-board-lane-state'
import { run_board_lane_stop } from './run-board-lane-stop'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#6577: a stopped lane keeps when and why it stopped; a working child is not stopped
// by its labels.

const ISSUE = 6577
const STARTED_MS = 1000
const PHASE_MS = 2000
const IDLE_MS = 5000
const ENDED_MS = 4000
const CLOSER = 'lane:close'
const RUNNING: ItemStatus = {
	state: 'running',
	started_ms: STARTED_MS,
	phase_ms: PHASE_MS,
	lane: 'lane 6577',
}
const STOPPED = 'stopped'

describe('run_board_lane_stop.lane_status', () => {
	it('dates the stop by the record that ended the lane over its first idle read', () => {
		const end = { ended_ms: ENDED_MS, by: CLOSER }

		expect(run_board_lane_stop.lane_status(RUNNING, IDLE_MS, end)).toStrictEqual({
			state: STOPPED,
			started_ms: STARTED_MS,
			lane: 'lane 6577',
			phase_ms: PHASE_MS,
			ended_ms: ENDED_MS,
			stop_reason: CLOSER,
		})
	})

	it('dates the stop by the first idle read where no record ended the lane', () => {
		const status = run_board_lane_stop.lane_status(RUNNING, IDLE_MS, undefined)

		expect(status).toMatchObject({ state: STOPPED, ended_ms: IDLE_MS, phase_ms: PHASE_MS })
		expect(status.stop_reason).toBeUndefined()
	})

	it('dates an idle stop by the transcript’s last write where it came before the idle read', () => {
		const status = run_board_lane_stop.lane_status(
			{ ...RUNNING, written_ms: ENDED_MS },
			IDLE_MS,
			undefined,
		)

		expect(status).toMatchObject({ state: STOPPED, ended_ms: ENDED_MS })
	})

	it('keeps a lane read working, and a child not running, as they are', () => {
		expect(run_board_lane_stop.lane_status(RUNNING, undefined, undefined)).toBe(RUNNING)

		const merged: ItemStatus = { state: 'merged' }

		expect(run_board_lane_stop.lane_status(merged, IDLE_MS, undefined)).toBe(merged)
	})
})

describe('run_board_lane_stop.stop_lanes', () => {
	it('stops a closed lane of this run by its record alone', () => {
		const statuses = new Map([[ISSUE, RUNNING]])
		const ended = new Map([[ISSUE, { ended_ms: ENDED_MS, by: CLOSER }]])
		const lanes = { ...run_board_lane_state.NO_LANES, ended }

		run_board_lane_stop.stop_lanes(statuses, lanes, new Map([[String(ISSUE), IDLE_MS]]))

		expect(statuses.get(ISSUE)).toMatchObject({ state: STOPPED, ended_ms: ENDED_MS })
	})

	it('reads idle only for a lane this run holds open', () => {
		const statuses = new Map([[ISSUE, RUNNING]])

		run_board_lane_stop.stop_lanes(
			statuses,
			run_board_lane_state.NO_LANES,
			new Map([[String(ISSUE), IDLE_MS]]),
		)

		expect(statuses.get(ISSUE)).toBe(RUNNING)
	})
})

describe('run_board_lane_stop.label_stop', () => {
	it('names the command each label state was left by', () => {
		expect(run_board_lane_stop.label_stop([IN_PROGRESS_LABEL])).toBeUndefined()
		expect(run_board_lane_stop.label_stop([])).toStrictEqual({
			state: STOPPED,
			reason: run_board_lane_stop.RELEASE_REASON,
		})
		expect(run_board_lane_stop.label_stop([IN_PROGRESS_LABEL, RUN_STALLED_LABEL])).toStrictEqual({
			state: STOPPED,
			reason: RUN_STALLED_LABEL,
		})
		expect(run_board_lane_stop.label_stop([NEEDS_DECISION_LABEL])).toStrictEqual({ state: 'human' })
		expect(run_board_lane_stop.label_stop(undefined)).toBeUndefined()
	})

	it.each([NEEDS_HUMAN_MERGE_LABEL, ALREADY_DONE_LABEL])(
		'names %s, not run:release, for a child still holding in-progress',
		(parked) => {
			expect(run_board_lane_stop.label_stop([IN_PROGRESS_LABEL, parked])).toStrictEqual({
				state: STOPPED,
				reason: parked,
			})
		},
	)
})

describe('run_board_lane_stop.label_settled', () => {
	const release = { state: STOPPED, reason: run_board_lane_stop.RELEASE_REASON } as const

	it('keeps a child its transcript reads running at work, its ship stopped', () => {
		const working: ItemStatus = { ...RUNNING, result: 'running' }

		expect(run_board_lane_stop.label_settled(working, release)).toStrictEqual({
			...working,
			stop_reason: run_board_lane_stop.RELEASE_REASON,
		})
	})

	it('stops a child whose transcript is unread or finished', () => {
		const finished: ItemStatus = { ...RUNNING, result: 'completed' }

		for (const status of [RUNNING, finished]) {
			expect(run_board_lane_stop.label_settled(status, release)).toMatchObject({
				state: STOPPED,
				stop_reason: run_board_lane_stop.RELEASE_REASON,
			})
		}
	})

	it('keeps the reason a stopped lane already recorded', () => {
		const stopped: ItemStatus = { state: STOPPED, ended_ms: ENDED_MS, stop_reason: CLOSER }

		expect(run_board_lane_stop.label_settled(stopped, release).stop_reason).toBe(CLOSER)
	})
})
