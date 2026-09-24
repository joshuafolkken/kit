import { describe, expect, it } from 'vitest'
import { run_carry } from './run-carry'
import { run_event_scope, type EventScope } from './run-event-scope'
import { run_event_stream, type RunEvent } from './run-event-stream'

// joshuafolkken/kit#2395: the scoped event read, published once so `run:report`, the retrospective digest
// and `run:step` share one time filter rather than each writing it again. The mechanism came from #2393
// (the carry record's `started_at` as the lower bound, filtered by each event's own time); these tests pin
// it at its new single-source home — including that an undetermined scope never rounds back to the whole
// stream, which is the rounding #2308 and #2393 named.

const KIND = run_event_stream.EVENT_KIND
const START = '2026-09-21T00:00:00.000Z'
const BEFORE = '2026-09-19T18:00:14.732Z'
const AFTER = '2026-09-21T06:00:00.000Z'
const NOT_A_TIME = 'not-a-time'

function since(started_at: string): EventScope {
	return { kind: 'since', started_at }
}

function event(pos: number, kind: string, at: string): RunEvent {
	return { pos, at, kind, text: kind }
}

const EARLIER = event(0, KIND.MERGE, BEFORE)
const AT_START = event(1, KIND.PARK, START)
const LATER = event(2, KIND.CUT, AFTER)
const MIXED: ReadonlyArray<RunEvent> = [EARLIER, AT_START, LATER]

describe('run_event_scope.scope_of', () => {
	const CARRY = run_carry.fresh_carry('backlogrun', {}, new Date(START))

	it('takes the start time from a carried record', () => {
		expect(run_event_scope.scope_of({ kind: 'carried', carry: CARRY })).toEqual(since(START))
	})

	it('takes it from an expired record too, since expiry is a budget verdict not a missing start', () => {
		expect(run_event_scope.scope_of({ kind: 'expired', carry: CARRY })).toEqual(since(START))
	})

	it('leaves the scope undetermined when no record is there or it cannot be read', () => {
		expect(run_event_scope.scope_of({ kind: 'none' })).toEqual(run_event_scope.UNKNOWN_EVENT_SCOPE)
		expect(run_event_scope.scope_of({ kind: 'unreadable' })).toEqual(
			run_event_scope.UNKNOWN_EVENT_SCOPE,
		)
	})
})

describe('run_event_scope.scoped_events', () => {
	it('keeps only events at or after the start, dropping a previous invocation’s', () => {
		const scoped = run_event_scope.scoped_events(MIXED, since(START))

		expect(scoped).toEqual([AT_START, LATER])
	})

	it('drops an event whose own timestamp cannot be read', () => {
		const corrupt = event(3, KIND.MERGE, NOT_A_TIME)

		expect(run_event_scope.scoped_events([...MIXED, corrupt], since(START))).toEqual([
			AT_START,
			LATER,
		])
	})

	it('answers undefined for an unknown scope, never the whole stream', () => {
		const scoped = run_event_scope.scoped_events(MIXED, run_event_scope.UNKNOWN_EVENT_SCOPE)

		expect(scoped).toBeUndefined()
	})

	it('answers undefined when the start time is not a time, never the whole stream', () => {
		expect(run_event_scope.scoped_events(MIXED, since(NOT_A_TIME))).toBeUndefined()
	})

	it('is an empty list, not undefined, for an invocation that has done nothing yet', () => {
		expect(run_event_scope.scoped_events([EARLIER], since(START))).toEqual([])
	})
})

describe('run_event_scope.last_scoped_event', () => {
	it('returns the newest event within scope', () => {
		expect(run_event_scope.last_scoped_event(MIXED, since(START))).toEqual(LATER)
	})

	it('skips a ship-stage trace event so the run position stays readable', () => {
		const trace = event(3, KIND.SHIP_STAGE, AFTER)

		expect(run_event_scope.last_scoped_event([...MIXED, trace], since(START))).toEqual(LATER)
	})

	it('returns undefined when only a previous invocation’s events are on the stream', () => {
		expect(run_event_scope.last_scoped_event([EARLIER], since(START))).toBeUndefined()
	})

	it('returns undefined for an undetermined scope, never a stale event', () => {
		expect(
			run_event_scope.last_scoped_event(MIXED, run_event_scope.UNKNOWN_EVENT_SCOPE),
		).toBeUndefined()
	})
})

// joshuafolkken/kit#2428: a detached ship supervisor's positions name their issue, and the stream is
// shared by every lane — so one issue's run reads its own supervisor and never another lane's.
const ISSUE = '2428'

function ship(pos: number, kind: string, issue: string): RunEvent {
	return { pos, at: AFTER, kind, text: `#${issue} gate failed` }
}

describe('run_event_scope.last_issue_event', () => {
	it('reads its own supervisor’s stop as the position', () => {
		const own = ship(3, KIND.SHIP_STOP, ISSUE)

		expect(run_event_scope.last_issue_event([...MIXED, own], since(START), ISSUE)).toEqual(own)
	})

	it('leaves another lane’s supervisor out of this run’s position', () => {
		const foreign = ship(3, KIND.SHIP_LAUNCH, '24280')

		expect(run_event_scope.last_issue_event([...MIXED, foreign], since(START), ISSUE)).toEqual(
			LATER,
		)
	})

	it('reads its own supervisor without a carry scope, as an interactive fullrun has none', () => {
		const own = ship(3, KIND.SHIP_LAUNCH, ISSUE)
		const events = [...MIXED, own, ship(4, KIND.SHIP_STOP, '99')]

		expect(
			run_event_scope.last_issue_event(events, run_event_scope.UNKNOWN_EVENT_SCOPE, ISSUE),
		).toEqual(own)
	})

	it('does not read an earlier invocation’s stop when this invocation’s scope is still empty', () => {
		const stale = { ...ship(3, KIND.SHIP_STOP, ISSUE), at: BEFORE }

		expect(run_event_scope.last_issue_event([EARLIER, stale], since(START), ISSUE)).toBeUndefined()
	})

	it('reads nothing without a scope when no supervisor of its own is on the stream', () => {
		expect(
			run_event_scope.last_issue_event(MIXED, run_event_scope.UNKNOWN_EVENT_SCOPE, ISSUE),
		).toBeUndefined()
	})
})
