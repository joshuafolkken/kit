import type { LaneStateRecord } from '#scripts/lane/lane-state'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_lane_state } from './run-board-lane-state'
import { run_board_lane_time, type EndingRead, type LaneTime } from './run-board-lane-time'
import type { BoardRow } from './run-board-layout'
import { run_board_render_time } from './run-board-render-time'
import { run_board_span } from './run-board-span'
import { run_board_status, type ItemStatus } from './run-board-status'

// joshuafolkken/kit#4481: an ending records its child's lane time as it is written, so a done row keeps
// its time when the launch lies outside the run's span — #4430 launched at 07:09:38Z, a new run began
// at 07:10:48Z, and it merged at 07:17:30Z.

const KIND = run_event_stream.EVENT_KIND
const ISSUE = 4430
const EARLIER_RUN = '2026-10-22T06:00:00.000Z'
const LAUNCHED_AT = '2026-10-22T07:09:38.000Z'
const RUN_STARTED_MS = Date.parse('2026-10-22T07:10:48.000Z')
const MERGED_MS = Date.parse('2026-10-22T07:17:30.000Z')
const LATER_MS = MERGED_MS + 60_000
const IN_LANE_MS = MERGED_MS - Date.parse(LAUNCHED_AT)
const BEFORE_LAUNCH = '2026-10-22T07:00:00.000Z'
const MID_LANE = '2026-10-22T07:12:00.000Z'
const LAUNCH: RunEvent = { pos: 1, at: LAUNCHED_AT, kind: KIND.CHILD_LAUNCH, text: '#4430' }
const RECORD: LaneStateRecord = {
	issue: String(ISSUE),
	run: { started_at: EARLIER_RUN },
	state: 'ended',
	launched_at: LAUNCHED_AT,
	changed_at: new Date(MERGED_MS).toISOString(),
	changed_by: 'lane:close',
}

function read_of(events: ReadonlyArray<RunEvent>, record?: LaneStateRecord): EndingRead {
	return { events, issue: ISSUE, record, ended_ms: MERGED_MS }
}

function merge_event(time: Partial<LaneTime> = {}): RunEvent {
	return {
		pos: 2,
		at: new Date(MERGED_MS).toISOString(),
		kind: KIND.MERGE,
		text: '#4430 merged',
		...time,
	}
}

function net(elapsed_ms: number, excluded_ms = 0): LaneTime {
	return { elapsed_ms, excluded_ms }
}

// The done row the run that began after the launch draws, its events cut to that run's span.
function done_time(events: ReadonlyArray<RunEvent>): string | undefined {
	const span = { invocation: 'run', started_ms: RUN_STARTED_MS, ended_ms: undefined }
	const cut = run_board_span.events_of(events, span)
	const status: ItemStatus | undefined = run_board_status
		.statuses_of(cut, run_board_lane_state.NO_LANES)
		.get(ISSUE)

	if (status === undefined) throw new Error('no status')

	const row: BoardRow = {
		number: ISSUE,
		title: 'Issue',
		kind: undefined,
		state: status.state,
		status,
		waits: [],
	}

	return run_board_render_time.time_of(row, LATER_MS)
}

describe('run_board_lane_time.ending_elapsed', () => {
	it('counts the child from its launch on the stream', () => {
		expect(run_board_lane_time.ending_elapsed(read_of([LAUNCH], RECORD))).toStrictEqual(
			net(IN_LANE_MS),
		)
	})

	it('counts from the lane record’s launch when the launch rolled off the stream', () => {
		expect(run_board_lane_time.ending_elapsed(read_of([], RECORD))).toStrictEqual(net(IN_LANE_MS))
	})

	it('records none for a child with no lane record', () => {
		expect(run_board_lane_time.ending_elapsed(read_of([LAUNCH]))).toBeUndefined()
	})

	it('records none when the lane’s newest span already ended', () => {
		const earlier_merge = { ...merge_event(), at: MID_LANE }

		expect(
			run_board_lane_time.ending_elapsed(read_of([LAUNCH, earlier_merge], RECORD)),
		).toBeUndefined()
	})

	// #4430's own history: launched and parked waiting a day earlier, then relaunched.
	it('leaves out a launch from before the run that last launched the child', () => {
		const old_launch = { ...LAUNCH, at: '2026-10-21T16:34:25.236Z' }
		const old_park = { ...old_launch, kind: KIND.PARK, at: '2026-10-21T16:40:11.122Z' }

		expect(
			run_board_lane_time.ending_elapsed(read_of([old_launch, old_park, LAUNCH], RECORD)),
		).toStrictEqual(net(IN_LANE_MS))
	})

	it('records none for a lane record with no launch', () => {
		const opened = { ...RECORD, launched_at: undefined }

		expect(run_board_lane_time.ending_elapsed(read_of([LAUNCH], opened))).toBeUndefined()
	})
})

describe('run_board_lane_time.ending_elapsed -- a child relaunched within its run', () => {
	it('sums every launch of the run that last launched it, as the board drew the open lane', () => {
		const first_launch = { ...LAUNCH, at: BEFORE_LAUNCH }
		const outage = { ...LAUNCH, kind: KIND.OUTAGE, at: '2026-10-22T07:05:00.000Z' }
		const first_span_ms = 5 * 60_000

		expect(
			run_board_lane_time.ending_elapsed(read_of([first_launch, outage, LAUNCH], RECORD)),
		).toStrictEqual(net(first_span_ms + IN_LANE_MS))
	})
})

// joshuafolkken/kit#7866: the host slept 2′30″ of #4430's lane, from 07:12:00Z.
const SLEPT_MS = 150_000
const NET_TIME = '5′22″ (+2′30″)'
const SLEEP: RunEvent = {
	pos: 3,
	at: new Date(Date.parse(MID_LANE) + SLEPT_MS).toISOString(),
	kind: KIND.SLEEP,
	text: 'host slept 2.5 min',
	elapsed_ms: SLEPT_MS,
}

describe('run_board_lane_time.ending_elapsed -- the host slept inside the lane', () => {
	it('records the time net of the sleep, and the sleep beside it', () => {
		expect(run_board_lane_time.ending_elapsed(read_of([LAUNCH, SLEEP], RECORD))).toStrictEqual(
			net(IN_LANE_MS - SLEPT_MS, SLEPT_MS),
		)
	})

	it('takes out none of a sleep before the launch', () => {
		const before = { ...SLEEP, at: BEFORE_LAUNCH }

		expect(run_board_lane_time.ending_elapsed(read_of([LAUNCH, before], RECORD))).toStrictEqual(
			net(IN_LANE_MS),
		)
	})
})

describe('run:board done row -- the host slept inside the lane', () => {
	it('draws the net time with the sleep beside it', () => {
		const time = run_board_lane_time.ending_elapsed(read_of([LAUNCH, SLEEP], RECORD))

		expect(done_time([LAUNCH, SLEEP, merge_event(time)])).toBe(NET_TIME)
	})

	it('takes the sleep out of an older merge that recorded the time with it', () => {
		expect(done_time([LAUNCH, SLEEP, merge_event({ elapsed_ms: IN_LANE_MS })])).toBe(NET_TIME)
	})
})

describe('run:board done row -- a launch outside the run’s span', () => {
	it('draws the time the merge recorded', () => {
		const elapsed_ms = run_board_lane_time.ending_elapsed(read_of([LAUNCH], RECORD))

		expect(done_time([LAUNCH, merge_event(elapsed_ms)])).toBe('7′52″')
	})

	it('draws no time for an older merge that recorded none, as before', () => {
		expect(done_time([LAUNCH, merge_event()])).toBeUndefined()
	})

	it('still counts an older merge whose launch lies inside the span', () => {
		const inside = { ...LAUNCH, at: new Date(RUN_STARTED_MS).toISOString() }

		expect(done_time([inside, merge_event()])).toBe(
			run_board_labels.span_of(MERGED_MS - RUN_STARTED_MS),
		)
	})

	it('draws the recorded time rather than counting it again', () => {
		const inside = { ...LAUNCH, at: new Date(RUN_STARTED_MS).toISOString() }

		expect(done_time([inside, merge_event({ elapsed_ms: IN_LANE_MS })])).toBe('7′52″')
	})
})
