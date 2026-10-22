import { IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_lane_state, type BoardLanes } from './run-board-lane-state'
import { run_board_status, type ItemStatus, type OpenRead } from './run-board-status'

// joshuafolkken/kit#3893: a lane whose child had died stood at 🔄 running, its 🔧 past 80 minutes,
// because nothing on the stream says a child died.

const KIND = run_event_stream.EVENT_KIND
const T0 = '2026-10-08T09:00:00.000Z'
const T1 = '2026-10-08T09:05:00.000Z'
const ISSUE = 3409
const LANE = '3409'
const NONE: ReadonlySet<number> = new Set()
const LAUNCH: RunEvent = { pos: 1, at: T0, kind: KIND.CHILD_LAUNCH, text: '#3409 launched' }
const HELD = { lane: 'lane 3409' }
const BARE: ItemStatus = { state: 'running' }

// This run's lane as its record draws it: what the stream folds of its launch, with its lane.
function own_lane(status: ItemStatus = BARE): BoardLanes {
	return { ...run_board_lane_state.NO_LANES, own: new Map([[ISSUE, { ...status, ...HELD }]]) }
}

const LAUNCHED = own_lane(run_board_status.fold_events([LAUNCH]).get(ISSUE))

// The listing read after the launch, still holding #3409 as in progress.
const OPEN: OpenRead = {
	open_numbers: new Set([ISSUE]),
	read_ms: Date.parse(T1),
	closed: new Map(),
	labels: new Map([[ISSUE, [IN_PROGRESS_LABEL]]]),
}

describe('run_board_status.statuses_of a lane no child is working in', () => {
	it('draws the child stopped with its lane, its phase no longer timed', () => {
		const statuses = run_board_status.statuses_of([LAUNCH], LAUNCHED, [LANE])

		expect(statuses.get(ISSUE)).toStrictEqual({
			state: 'stopped',
			started_ms: Date.parse(T0),
			spans: [{ from_ms: Date.parse(T0), end_ms: undefined }],
			track: ['investigate'],
			lane: 'lane 3409',
		})
	})

	it('draws a lane the stream never saw launched stopped too', () => {
		const statuses = run_board_status.statuses_of([], own_lane(), [LANE])

		expect(statuses.get(ISSUE)).toStrictEqual({
			state: 'stopped',
			started_ms: undefined,
			lane: 'lane 3409',
		})
	})

	it('keeps a lane a child is working in running', () => {
		const statuses = run_board_status.statuses_of([LAUNCH], LAUNCHED, ['3415'])

		expect(statuses.get(ISSUE)?.state).toBe('running')
	})
})

describe('run_board_status.settle_closed a stopped lane', () => {
	it('leaves it stopped while its issue is open and in progress', () => {
		const statuses = run_board_status.statuses_of([LAUNCH], LAUNCHED, [LANE])

		expect(run_board_status.settle_closed(statuses, OPEN).get(ISSUE)?.state).toBe('stopped')
	})

	it('draws it merged once GitHub says its issue merged after the launch', () => {
		const statuses = run_board_status.statuses_of([LAUNCH], LAUNCHED, [LANE])
		const merged = {
			title: '',
			labels: [],
			is_merged: true,
			is_not_planned: false,
			closed_ms: Date.parse(T1),
		}
		const closed = new Map([[ISSUE, merged]])
		const read = { ...OPEN, open_numbers: NONE, closed }

		expect(run_board_status.settle_closed(statuses, read).get(ISSUE)?.state).toBe('merged')
	})
})
