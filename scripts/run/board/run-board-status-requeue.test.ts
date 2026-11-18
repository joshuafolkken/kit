import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_lane_state } from './run-board-lane-state'
import { run_board_status } from './run-board-status'

// joshuafolkken/kit#8028: a child handed back to the queue — released on an authentication failure, or
// re-added once its lane ended — is drawn waiting in the queue, not stopped by its lane's earlier end.

const KIND = run_event_stream.EVENT_KIND
const LAUNCHED_AT = '2026-11-18T13:56:57.000Z'
const RELEASED_AT = '2026-11-18T14:01:00.000Z'
const ENDED_AT = '2026-11-18T14:01:05.000Z'
const ADDED_AT = '2026-11-18T15:40:44.000Z'
const ISSUE = 7930
const LAUNCH: RunEvent = {
	pos: 1,
	at: LAUNCHED_AT,
	kind: KIND.CHILD_LAUNCH,
	text: '#7930 launched',
}
const ADDED: RunEvent = { pos: 3, at: ADDED_AT, kind: KIND.ADD, text: 'added #7930' }
const AUTH_LIMIT = 'authentication failure'

function hold(limit: string): RunEvent {
	const text = `#7930 ${limit} — resumes at 2026-11-18T14:11:00.000Z`

	return { pos: 2, at: RELEASED_AT, kind: KIND.USAGE_LIMIT, text }
}

// The board row of #7930 after `events`, with its lane's record ended by `lane:close`.
function row_after(events: ReadonlyArray<RunEvent>): string | undefined {
	const ended = new Map([[ISSUE, { ended_ms: Date.parse(ENDED_AT), by: 'lane:close' }]])
	const lanes = { ...run_board_lane_state.NO_LANES, ended }

	return run_board_status.statuses_of(events, lanes).get(ISSUE)?.state
}

describe('run_board_status.statuses_of requeued children', () => {
	it('draws a child released on an authentication failure as waiting, not stopped', () => {
		expect(row_after([LAUNCH, hold(AUTH_LIMIT)])).toBe('waiting')
	})

	it('draws a child re-added after its release as waiting', () => {
		expect(row_after([LAUNCH, hold(AUTH_LIMIT), ADDED])).toBe('waiting')
	})

	it('keeps a child held by a usage limit, whose lane a person closed, stopped', () => {
		expect(row_after([LAUNCH, hold('usage limit')])).toBe('stopped')
	})

	it('keeps a running child running when it is added again', () => {
		const statuses = run_board_status.statuses_of([LAUNCH, ADDED], run_board_lane_state.NO_LANES)

		expect(statuses.get(ISSUE)?.state).toBe('running')
	})

	it('draws no row for an added issue the stream never launched', () => {
		const statuses = run_board_status.statuses_of([ADDED], run_board_lane_state.NO_LANES)

		expect(statuses.has(ISSUE)).toBe(false)
	})
})
