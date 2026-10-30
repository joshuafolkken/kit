import type { LaneState, LaneStateRecord } from '#scripts/lane/lane-state'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_lane_state, type BoardLanes } from './run-board-lane-state'
import { run_board_status } from './run-board-status'

// joshuafolkken/kit#4269: run:board guessed each lane's state from the run's span, the `.env` mtime and
// the `ps` state, so an earlier run's lane, a cut or a resume and a stray process each drew it wrong.

const KIND = run_event_stream.EVENT_KIND
const EARLIER_RUN = '2026-10-08T07:00:00.000Z'
const THIS_RUN = '2026-10-08T09:00:00.000Z'
const LAUNCHED = '2026-10-08T09:10:00.000Z'
const LATER = '2026-10-08T09:20:00.000Z'
const ISSUE = '4269'
const NUMBER = Number(ISSUE)

function record_of(state: LaneState, run_started_at = THIS_RUN): LaneStateRecord {
	return {
		issue: ISSUE,
		run: { started_at: run_started_at },
		state,
		launched_at: LAUNCHED,
		changed_at: LATER,
		changed_by: 'lane:dispatch',
	}
}

function event_of(pos: number, at: string, kind: string, text = `#${ISSUE}`): RunEvent {
	return { pos, at, kind, text }
}

function lanes_of(
	records: ReadonlyArray<LaneStateRecord>,
	events: ReadonlyArray<RunEvent> = [],
	lanes: ReadonlyArray<string> = [ISSUE],
): BoardLanes {
	return run_board_lane_state.lanes_of({
		events,
		lanes,
		records: new Map(records.map((record) => [record.issue, record])),
		started_ms: Date.parse(THIS_RUN),
	})
}

describe('run_board_lane_state.lanes_of — whose lane it is', () => {
	it('sorts a lane an earlier run launched as earlier, whatever its stream says in this run', () => {
		const events = [event_of(1, LATER, KIND.CUT), event_of(2, LATER, KIND.RESUME)]
		const lanes = lanes_of([record_of('running', EARLIER_RUN)], events)

		expect(lanes.own.has(NUMBER)).toBe(false)
		expect(lanes.earlier.get(NUMBER)).toMatchObject({ state: 'running' })
	})

	it('sorts a lane this run launched as its own', () => {
		const lanes = lanes_of([record_of('running')])

		expect(lanes.own.get(NUMBER)).toMatchObject({ state: 'running', lane: `lane ${ISSUE}` })
		expect(lanes.earlier.size).toBe(0)
	})

	it.each([
		['its own', LAUNCHED, true],
		['an earlier run’s', EARLIER_RUN, false],
	])('sorts a migrated record, which names no run, by its launch as %s', (_, at, is_own) => {
		const lanes = lanes_of([{ ...record_of('running'), run: undefined, launched_at: at }])

		expect(lanes.own.has(NUMBER)).toBe(is_own)
		expect(lanes.earlier.has(NUMBER)).toBe(!is_own)
	})

	it('draws a lane with no record unknown, not guessed at', () => {
		expect(lanes_of([])).toStrictEqual({ own: new Map(), earlier: new Map(), unknown: [ISSUE] })
	})

	it.each<LaneState>(['open', 'ended'])('draws no row of a lane whose record is %s', (state) => {
		expect(lanes_of([record_of(state)])).toStrictEqual(run_board_lane_state.NO_LANES)
	})
})

describe('run_board_lane_state.lanes_of — human review', () => {
	it.each([THIS_RUN, EARLIER_RUN])('keeps a human-review lane from %s with stopped time', (run) => {
		const lanes = lanes_of([record_of('human-review', run)])
		const status = (run === THIS_RUN ? lanes.own : lanes.earlier).get(NUMBER)

		expect(status).toMatchObject({
			state: 'human',
			started_ms: Date.parse(LAUNCHED),
			ended_ms: Date.parse(LATER),
		})

		if (run === EARLIER_RUN) {
			expect(run_board_lane_state.earlier_occupied([ISSUE], lanes)).toStrictEqual([ISSUE])
		}
	})

	it('ends a human-review child from the event stream without a record', () => {
		const events = [event_of(1, LAUNCHED, KIND.CHILD_LAUNCH), event_of(2, LATER, KIND.HUMAN_REVIEW)]
		const status = run_board_status.statuses_of(events, run_board_lane_state.NO_LANES).get(NUMBER)

		expect(status).toMatchObject({ state: 'human', ended_ms: Date.parse(LATER) })
		expect(status?.spans).toStrictEqual([
			{ from_ms: Date.parse(LAUNCHED), end_ms: Date.parse(LATER) },
		])
	})
})

describe('run_board_lane_state.lanes_of — what the lane is doing', () => {
	it('draws a lane paused as its record says, paused since the record last changed', () => {
		const lanes = lanes_of([record_of('paused')])

		expect(lanes.own.get(NUMBER)).toMatchObject({
			state: 'paused',
			started_ms: Date.parse(LAUNCHED),
			ended_ms: Date.parse(LATER),
		})
	})

	it('counts its time from the record’s newest launch across a cut and a resume', () => {
		const events = [
			event_of(1, EARLIER_RUN, KIND.CHILD_LAUNCH),
			event_of(2, LATER, KIND.CUT),
			event_of(3, LATER, KIND.RESUME),
		]
		const lanes = lanes_of([record_of('running')], events)

		expect(lanes.own.get(NUMBER)?.started_ms).toBe(Date.parse(LAUNCHED))
	})

	// joshuafolkken/kit#4260: an earlier run's lane launched before this run's span began.
	it('folds the phase from the lane’s launch, not from the run’s span', () => {
		const events = [
			event_of(1, LAUNCHED, KIND.CHILD_LAUNCH),
			event_of(2, LATER, KIND.LANE_PHASE, `#${ISSUE} implement`),
		]
		const lanes = lanes_of([record_of('running', EARLIER_RUN)], events)

		expect(lanes.earlier.get(NUMBER)?.track?.at(-1)).toBe('implement')
	})
})

describe('run_board_lane_state.lanes_of — an ending on the stream', () => {
	it('lets an ending the stream holds since the launch stand', () => {
		const events = [event_of(1, LAUNCHED, KIND.CHILD_LAUNCH), event_of(2, LATER, KIND.MERGE)]

		expect(lanes_of([record_of('running')], events).own.get(NUMBER)?.state).toBe('merged')
	})

	it('lets no ending from before the record’s newest launch stand', () => {
		const events = [
			event_of(1, EARLIER_RUN, KIND.CHILD_LAUNCH),
			event_of(2, EARLIER_RUN, KIND.MERGE),
		]

		expect(lanes_of([record_of('running')], events).own.get(NUMBER)?.state).toBe('running')
	})
})

describe('run_board_lane_state.earlier_occupied — an earlier run’s lane on the board', () => {
	it('keeps an earlier run’s lane that holds a place', () => {
		const lanes = lanes_of([record_of('running', EARLIER_RUN)])

		expect(run_board_lane_state.earlier_occupied([ISSUE], lanes)).toStrictEqual([ISSUE])
	})

	it('drops an earlier run’s lane that holds no place', () => {
		const lanes = lanes_of([record_of('running', EARLIER_RUN)])

		expect(run_board_lane_state.earlier_occupied([], lanes)).toStrictEqual([])
	})

	it('drops this run’s own lane though it holds a place', () => {
		const lanes = lanes_of([record_of('running')])

		expect(run_board_lane_state.earlier_occupied([ISSUE], lanes)).toStrictEqual([])
	})
})

describe('run_board_status.statuses_of — an earlier run’s lane in this run’s span', () => {
	it('keeps what the span says of an earlier run’s lane out of this run’s statuses', () => {
		const events = [event_of(1, LATER, KIND.CHILD_LAUNCH)]
		const lanes = lanes_of([record_of('running', EARLIER_RUN)], events)

		expect(run_board_status.statuses_of(events, lanes).has(NUMBER)).toBe(false)
	})

	it('keeps what the span says of a lane with no record out of this run’s statuses', () => {
		const events = [event_of(1, LATER, KIND.CHILD_LAUNCH)]

		expect(run_board_status.statuses_of(events, lanes_of([], events)).has(NUMBER)).toBe(false)
	})
})
