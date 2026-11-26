import {
	ALREADY_DONE_LABEL,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
	RUN_STALLED_LABEL,
} from '#scripts/issue/issue-labels'
import { run_resume_wait, type ResumeWaits } from '#scripts/run/event/run-resume-wait'
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
const { SEAT_WAIT } = run_resume_wait
const NO_WAITS: ResumeWaits = new Map()
const WAITING: ResumeWaits = new Map([[String(ISSUE), SEAT_WAIT]])

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

		run_board_lane_stop.stop_lanes(statuses, lanes, new Map([[String(ISSUE), IDLE_MS]]), NO_WAITS)

		expect(statuses.get(ISSUE)).toMatchObject({ state: STOPPED, ended_ms: ENDED_MS })
	})

	it('reads idle only for a lane this run holds open', () => {
		const statuses = new Map([[ISSUE, RUNNING]])

		run_board_lane_stop.stop_lanes(
			statuses,
			run_board_lane_state.NO_LANES,
			new Map([[String(ISSUE), IDLE_MS]]),
			NO_WAITS,
		)

		expect(statuses.get(ISSUE)).toBe(RUNNING)
	})
})

describe('run_board_lane_stop.stop_lanes outage waits', () => {
	it.each([
		['beside the reason it stopped for', CLOSER],
		['where nothing named the stop', undefined],
	])('carries an outage wait %s in its own field', (_case, stop_reason) => {
		const stopped: ItemStatus = {
			state: STOPPED,
			...(stop_reason !== undefined && { stop_reason }),
		}
		const statuses = new Map([[ISSUE, stopped]])

		run_board_lane_stop.stop_lanes(statuses, run_board_lane_state.NO_LANES, new Map(), WAITING)

		expect(statuses.get(ISSUE)?.resume_wait).toBe(SEAT_WAIT)
		expect(statuses.get(ISSUE)?.stop_reason).toBe(stop_reason)
	})

	it('leaves a running child, and a wait with no reason yet, unchanged', () => {
		const statuses = new Map([[ISSUE, RUNNING]])
		const unreasoned = new Map([[String(ISSUE), undefined]])

		run_board_lane_stop.stop_lanes(statuses, run_board_lane_state.NO_LANES, new Map(), WAITING)
		run_board_lane_stop.stop_lanes(statuses, run_board_lane_state.NO_LANES, new Map(), unreasoned)

		expect(statuses.get(ISSUE)).toBe(RUNNING)
	})
})

describe('run_board_lane_stop.label_stop', () => {
	it('names the command each label state was left by', () => {
		expect(run_board_lane_stop.label_stop([IN_PROGRESS_LABEL])).toBeUndefined()
		expect(run_board_lane_stop.label_stop([])).toStrictEqual({
			state: STOPPED,
			reason: run_board_lane_stop.UNLABELLED_REASON,
		})
		expect(run_board_lane_stop.label_stop([IN_PROGRESS_LABEL, RUN_STALLED_LABEL])).toStrictEqual({
			state: STOPPED,
			reason: RUN_STALLED_LABEL,
		})
		expect(run_board_lane_stop.label_stop([NEEDS_DECISION_LABEL])).toStrictEqual({ state: 'human' })
		expect(run_board_lane_stop.label_stop(undefined)).toBeUndefined()
	})

	it('names already-done, not run:release, for a child still holding in-progress', () => {
		expect(run_board_lane_stop.label_stop([IN_PROGRESS_LABEL, ALREADY_DONE_LABEL])).toStrictEqual({
			state: STOPPED,
			reason: ALREADY_DONE_LABEL,
		})
	})

	// joshuafolkken/kit#8026: a merge wait is a person's to act on, so it reads as the 🙋 human stop.
	it('reads needs-human-merge as a human stop for a child still holding in-progress', () => {
		expect(
			run_board_lane_stop.label_stop([IN_PROGRESS_LABEL, NEEDS_HUMAN_MERGE_LABEL]),
		).toStrictEqual({ state: 'human' })
	})
})

describe('run_board_lane_stop.label_settled', () => {
	const { UNLABELLED_REASON } = run_board_lane_stop
	const release = { state: STOPPED, reason: UNLABELLED_REASON } as const

	it('keeps a child its transcript reads running at work, its ship stopped', () => {
		const working: ItemStatus = { ...RUNNING, result: 'running' }

		expect(run_board_lane_stop.label_settled(working, release)).toStrictEqual({
			...working,
			stop_reason: UNLABELLED_REASON,
		})
	})

	it('stops a child whose transcript is unread or finished', () => {
		const finished: ItemStatus = { ...RUNNING, result: 'completed' }

		for (const status of [RUNNING, finished]) {
			expect(run_board_lane_stop.label_settled(status, release)).toMatchObject({
				state: STOPPED,
				stop_reason: UNLABELLED_REASON,
			})
		}
	})

	it('keeps the reason a stopped lane already recorded', () => {
		const stopped: ItemStatus = { state: STOPPED, ended_ms: ENDED_MS, stop_reason: CLOSER }

		expect(run_board_lane_stop.label_settled(stopped, release).stop_reason).toBe(CLOSER)
	})
})

// joshuafolkken/kit#7750: a lane whose child or detached ship is alive only lost its label.
describe('run_board_lane_stop — a live lane', () => {
	const { UNLABELLED_REASON } = run_board_lane_stop
	const release = { state: STOPPED, reason: UNLABELLED_REASON } as const

	it('marks an open lane of this run read alive, and not one read idle', () => {
		const own = new Map([[ISSUE, RUNNING]])
		const lanes = { ...run_board_lane_state.NO_LANES, own }
		const live = new Map([[ISSUE, RUNNING]])
		const idle = new Map([[ISSUE, RUNNING]])

		run_board_lane_stop.stop_lanes(live, lanes, new Map(), NO_WAITS)
		run_board_lane_stop.stop_lanes(idle, lanes, new Map([[String(ISSUE), IDLE_MS]]), NO_WAITS)

		expect(live.get(ISSUE)).toStrictEqual({ ...RUNNING, is_live: true })
		expect(idle.get(ISSUE)?.is_live).toBeUndefined()
	})

	it('keeps a live lane without in-progress running, noting the missing label', () => {
		const live: ItemStatus = { ...RUNNING, result: 'completed', is_live: true }

		expect(run_board_lane_stop.label_settled(live, release)).toStrictEqual({
			...live,
			stop_reason: UNLABELLED_REASON,
		})
	})

	it('still stops a live lane a park label names', () => {
		const live: ItemStatus = { ...RUNNING, is_live: true }
		const parked = { state: STOPPED, reason: RUN_STALLED_LABEL } as const

		expect(run_board_lane_stop.label_settled(live, parked)).toMatchObject({
			state: STOPPED,
			stop_reason: RUN_STALLED_LABEL,
		})
	})
})
