import type { CarryRead, RunCarry } from '#scripts/run/carry/run-carry'
import type { EndedRun } from '#scripts/run/carry/run-carry-ended'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_span } from './run-board-span'

// joshuafolkken/kit#3439: which run the board draws — the running one, else the one that last ended —
// and that the span keeps every other run's events off it.

const FIRST_START = '2026-10-08T09:00:00.000Z'
const FIRST_END = '2026-10-08T10:00:00.000Z'
const SECOND_START = '2026-10-08T11:00:00.000Z'
const SECOND_END = '2026-10-08T12:00:00.000Z'
const NONE: CarryRead = { kind: 'none' }
const EPIC_RUN = 'backlogrun #3431'

function carry(started_at: string): RunCarry {
	return {
		invocation: 'backlogrun',
		started_at,
		merged: 0,
		filed: 0,
		cuts: 0,
		failures: 0,
		outages: 0,
	}
}

function ended(started_at: string, ended_at: string): EndedRun {
	return { invocation: EPIC_RUN, started_at, ended_at }
}

function event(pos: number, at: string): RunEvent {
	return { pos, at, kind: 'merge', text: `#${String(pos)} merged` }
}

const STREAM = [
	event(1, '2026-10-08T09:30:00.000Z'),
	event(2, '2026-10-08T10:30:00.000Z'),
	event(3, '2026-10-08T11:30:00.000Z'),
]

describe('run_board_span.span_of', () => {
	it('draws the run that ended once, from its start to its end', () => {
		const span = run_board_span.span_of(NONE, ended(FIRST_START, FIRST_END))

		expect(span).toStrictEqual({
			invocation: EPIC_RUN,
			started_ms: Date.parse(FIRST_START),
			ended_ms: Date.parse(FIRST_END),
		})
		expect(span && run_board_span.events_of(STREAM, span)).toStrictEqual([STREAM[0]])
	})

	it('draws the second run while it runs, never the first one that ended', () => {
		const read: CarryRead = { kind: 'carried', carry: carry(SECOND_START) }
		const span = run_board_span.span_of(read, ended(FIRST_START, FIRST_END))

		expect(span?.ended_ms).toBeUndefined()
		expect(span && run_board_span.events_of(STREAM, span)).toStrictEqual([STREAM[2]])
	})

	it('draws the second run once both have ended, with none of the first run’s events', () => {
		const span = run_board_span.span_of(NONE, ended(SECOND_START, SECOND_END))

		expect(span && run_board_span.events_of(STREAM, span)).toStrictEqual([STREAM[2]])
	})

	it('draws nothing when no run has ever run, or the record does not name a time', () => {
		expect(run_board_span.span_of(NONE, undefined)).toBeUndefined()
		expect(run_board_span.span_of(NONE, ended('later', FIRST_END))).toBeUndefined()
		expect(
			run_board_span.span_of({ kind: 'carried', carry: carry('soon') }, undefined),
		).toBeUndefined()
	})

	it('draws nothing over a spent or unreadable carry rather than the run before it', () => {
		const before = ended(FIRST_START, FIRST_END)

		expect(
			run_board_span.span_of({ kind: 'expired', carry: carry(SECOND_START) }, before),
		).toBeUndefined()
		expect(run_board_span.span_of({ kind: 'unreadable' }, before)).toBeUndefined()
	})
})
