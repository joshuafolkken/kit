import type { PendingLaunch } from '#scripts/backlog/backlogrun-launch'
import type { CarryRead, RunCarry } from '#scripts/run/carry/run-carry'
import type { EndedRun } from '#scripts/run/carry/run-carry-ended'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_span } from './run-board-span'

// joshuafolkken/kit#3439: which run the board draws — the running one, else the one that last ended —
// and that the span keeps every other run's events off it. joshuafolkken/kit#3696: a run `josh
// backlogrun` launched is drawn from its launch, before its parent claims the carry record.

const FIRST_START = '2026-10-08T09:00:00.000Z'
const FIRST_END = '2026-10-08T10:00:00.000Z'
const SECOND_START = '2026-10-08T11:00:00.000Z'
const SECOND_END = '2026-10-08T12:00:00.000Z'
const NONE: CarryRead = { kind: 'none' }
const EPIC_RUN = 'backlogrun #3431'
const SESSION = 'session-1'

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

function launch(started_at: string): PendingLaunch {
	return { invocation: 'backlogrun', started_at }
}

function stopped(started_at: string, ended_at: string): EndedRun {
	return { ...ended(started_at, ended_at), stopped: 'budget', session: SESSION }
}

function event(pos: number, at: string): RunEvent {
	return { pos, at, kind: 'merge', text: `#${String(pos)} merged` }
}

const STREAM = [
	event(1, '2026-10-08T09:30:00.000Z'),
	event(2, '2026-10-08T10:30:00.000Z'),
	event(3, '2026-10-08T11:30:00.000Z'),
]

describe('run_board_span scheduler', () => {
	it.each(['anthropic', 'openai'] as const)(
		'keeps %s scoped to the selected run across launch, carry and end',
		(scheduler_provider) => {
			const pending = { ...launch(SECOND_START), scheduler_provider }
			const current = { ...carry(SECOND_START), scheduler_provider }
			const finished = { ...ended(SECOND_START, SECOND_END), scheduler_provider }
			const old = ended(FIRST_START, FIRST_END)

			expect(run_board_span.span_of(NONE, old, pending)?.scheduler_provider).toBe(
				scheduler_provider,
			)
			expect(
				run_board_span.span_of({ kind: 'carried', carry: current }, old)?.scheduler_provider,
			).toBe(scheduler_provider)
			expect(run_board_span.span_of(NONE, finished)?.scheduler_provider).toBe(scheduler_provider)
			expect(
				run_board_span.span_of({ kind: 'carried', carry: carry(SECOND_START) }, finished, pending)
					?.scheduler_provider,
			).toBeUndefined()
		},
	)
})

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

	it('draws nothing over an unreadable carry rather than the run before it', () => {
		const before = ended(FIRST_START, FIRST_END)

		expect(run_board_span.span_of({ kind: 'unreadable' }, before)).toBeUndefined()
	})
})

describe('run_board_span.span_of with a launch its parent has not claimed', () => {
	it('draws the launch as the run while no carry record stands', () => {
		expect(run_board_span.span_of(NONE, undefined, launch(SECOND_START))).toStrictEqual({
			invocation: 'backlogrun',
			started_ms: Date.parse(SECOND_START),
			ended_ms: undefined,
		})
	})

	it('keeps the start where the carry inherited it, so the clock does not restart', () => {
		const pending = launch(SECOND_START)
		const before = run_board_span.span_of(NONE, undefined, pending)
		const read: CarryRead = { kind: 'carried', carry: carry(SECOND_START) }

		expect(run_board_span.span_of(read, undefined, pending)?.started_ms).toBe(before?.started_ms)
	})

	it('draws the carry’s own start once a record stands, whatever the launch says', () => {
		const read: CarryRead = { kind: 'carried', carry: carry(SECOND_START) }
		const span = run_board_span.span_of(read, undefined, launch(FIRST_START))

		expect(span?.started_ms).toBe(Date.parse(SECOND_START))
	})

	it('replaces the run that ended before it, and yields to one that ended after it', () => {
		const pending = launch(SECOND_START)
		const earlier = run_board_span.span_of(NONE, ended(FIRST_START, FIRST_END), pending)
		const later = run_board_span.span_of(NONE, ended(FIRST_START, SECOND_END), pending)

		expect(earlier?.ended_ms).toBeUndefined()
		expect(later?.ended_ms).toBe(Date.parse(SECOND_END))
	})

	it('draws the ended run when the launch names no time', () => {
		const span = run_board_span.span_of(NONE, ended(FIRST_START, FIRST_END), launch('soon'))

		expect(span?.ended_ms).toBe(Date.parse(FIRST_END))
	})
})

describe('run_board_span.resume_of', () => {
	it('offers the stopped run’s session while that run is the one drawn', () => {
		expect(run_board_span.resume_of(NONE, stopped(FIRST_START, FIRST_END))).toBe(SESSION)
		expect(run_board_span.resume_of(NONE, ended(FIRST_START, FIRST_END))).toBeUndefined()
	})

	it('hides it while a launch newer than that run is drawn', () => {
		const last = stopped(FIRST_START, FIRST_END)

		expect(run_board_span.resume_of(NONE, last, launch(SECOND_START))).toBeUndefined()
		expect(run_board_span.resume_of(NONE, last, launch(FIRST_START))).toBe(SESSION)
	})

	it('hides it once a run is carried', () => {
		const read: CarryRead = { kind: 'carried', carry: carry(SECOND_START) }

		expect(run_board_span.resume_of(read, stopped(FIRST_START, FIRST_END))).toBeUndefined()
	})
})
