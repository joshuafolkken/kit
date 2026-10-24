import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_lane_state, type BoardLanes } from './run-board-lane-state'
import { run_board_lane_time } from './run-board-lane-time'
import type { BoardRow } from './run-board-layout'
import { run_board_render_time } from './run-board-render-time'
import {
	run_board_status,
	type ItemState,
	type ItemStatus,
	type OpenRead,
} from './run-board-status'

// joshuafolkken/kit#4463: a row's time is the sum of its spans on a lane — the gap before a relaunch is
// not counted, and a running row does not jump when it settles.

const KIND = run_event_stream.EVENT_KIND
const ISSUE = 4463
const MINUTE = 60_000
const T0 = Date.parse('2026-10-22T10:00:00.000Z')
const OUTAGE_AT = T0 + 10 * MINUTE
const RELAUNCH_AT = T0 + 60 * MINUTE
const MERGE_AT = RELAUNCH_AT + 5 * MINUTE
const LATER = MERGE_AT + 60 * MINUTE
const IN_LANE = run_board_labels.span_of(15 * MINUTE)
const { NO_LANES } = run_board_lane_state
const { time_of } = run_board_render_time

function event_at(at_ms: number, kind: string, text = `#${String(ISSUE)}`): RunEvent {
	return { pos: 0, at: new Date(at_ms).toISOString(), kind, text }
}

const RELAUNCHED = [
	event_at(T0, KIND.CHILD_LAUNCH),
	event_at(OUTAGE_AT, KIND.OUTAGE),
	event_at(RELAUNCH_AT, KIND.CHILD_LAUNCH),
]

// GitHub's read of the child closed by its merge, which the stream never saw.
const CLOSED_READ: OpenRead = {
	open_numbers: new Set(),
	read_ms: LATER,
	closed: new Map([
		[
			ISSUE,
			{ title: 'Issue', labels: [], closed_ms: MERGE_AT, is_merged: true, is_not_planned: false },
		],
	]),
	labels: new Map(),
}

function status_of(events: ReadonlyArray<RunEvent>, lanes: BoardLanes = NO_LANES): ItemStatus {
	const status = run_board_status.statuses_of(events, lanes).get(ISSUE)

	if (status === undefined) throw new Error('no status')

	return status
}

function row_of(status: ItemStatus, state: ItemState = status.state): BoardRow {
	return { number: ISSUE, title: 'Issue', kind: undefined, state, status, waits: [] }
}

// The time drawn at `now_ms` for the row `events` fold to, with this run's lane `own` laid over it.
function time_after(
	events: ReadonlyArray<RunEvent>,
	now_ms: number,
	own?: ItemStatus,
): string | undefined {
	const lanes = own === undefined ? NO_LANES : { ...NO_LANES, own: new Map([[ISSUE, own]]) }

	return time_of(row_of(status_of(events, lanes)), now_ms)
}

describe('run_board_lane_time -- a relaunched child', () => {
	it('times a merged row as its two spans, not the gap between them', () => {
		expect(time_after([...RELAUNCHED, event_at(MERGE_AT, KIND.MERGE)], LATER)).toBe(IN_LANE)
	})

	it('times a running row as its earlier span and its current one', () => {
		expect(time_after(RELAUNCHED, MERGE_AT)).toBe(IN_LANE)
	})

	it('leaves the wait out of a row a usage limit stopped, as it does an outage', () => {
		const limited = [
			event_at(T0, KIND.CHILD_LAUNCH),
			event_at(OUTAGE_AT, KIND.USAGE_LIMIT),
			event_at(RELAUNCH_AT, KIND.CHILD_LAUNCH),
			event_at(MERGE_AT, KIND.MERGE),
		]

		expect(time_after(limited, LATER)).toBe(IN_LANE)
	})

	it('ends a row closed on GitHub at its close', () => {
		const statuses = new Map([[ISSUE, status_of(RELAUNCHED)]])
		const settled = run_board_status.settle_closed(statuses, CLOSED_READ).get(ISSUE)

		expect(settled === undefined ? undefined : time_of(row_of(settled), LATER)).toBe(IN_LANE)
	})
})

describe('run_board_lane_time -- a span on the lanes', () => {
	it('keeps counting across a cut and its resume', () => {
		const resumed = [
			event_at(T0, KIND.CHILD_LAUNCH),
			event_at(OUTAGE_AT, KIND.CUT),
			event_at(RELAUNCH_AT, KIND.RESUME),
			event_at(MERGE_AT, KIND.MERGE),
		]

		expect(time_after(resumed, LATER)).toBe(run_board_labels.span_of(MERGE_AT - T0))
	})

	it('ends a span nothing took off the lanes at the next launch, counting it once', () => {
		const restarted = [
			event_at(T0, KIND.CHILD_LAUNCH),
			event_at(RELAUNCH_AT, KIND.RESTART),
			event_at(MERGE_AT, KIND.MERGE),
		]

		expect(time_after(restarted, LATER)).toBe(run_board_labels.span_of(MERGE_AT - T0))
	})

	it('counts nothing of a span that starts after the row ended', () => {
		const spans = [
			{ from_ms: T0, end_ms: OUTAGE_AT },
			{ from_ms: MERGE_AT, end_ms: undefined },
		]

		expect(run_board_lane_time.in_lane_ms(spans, RELAUNCH_AT)).toBe(OUTAGE_AT - T0)
	})

	it('stops a paused lane at its pause, its earlier span still counted', () => {
		const paused: ItemStatus = { state: 'paused', started_ms: RELAUNCH_AT, ended_ms: MERGE_AT }

		expect(time_after(RELAUNCHED, LATER, paused)).toBe(IN_LANE)
	})

	it('times a lane the stream never saw launched from its record', () => {
		const running: ItemStatus = { state: 'running', started_ms: RELAUNCH_AT }

		expect(time_after([], MERGE_AT, running)).toBe(run_board_labels.span_of(5 * MINUTE))
	})
})
