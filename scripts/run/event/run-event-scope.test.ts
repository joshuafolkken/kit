import { run_carry } from '#scripts/run/carry/run-carry'
import { describe, expect, it } from 'vitest'
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

		expect(run_event_scope.last_issue_event([...MIXED, own], since(START), ISSUE, false)).toEqual(
			own,
		)
	})

	it('leaves another lane’s supervisor out of this run’s position', () => {
		const foreign = ship(3, KIND.SHIP_LAUNCH, '24280')

		expect(
			run_event_scope.last_issue_event([...MIXED, foreign], since(START), ISSUE, false),
		).toEqual(LATER)
	})

	it('reads its own supervisor without a carry scope, as an interactive fullrun has none', () => {
		const own = ship(3, KIND.SHIP_LAUNCH, ISSUE)
		const events = [...MIXED, own, ship(4, KIND.SHIP_STOP, '99')]

		expect(
			run_event_scope.last_issue_event(events, run_event_scope.UNKNOWN_EVENT_SCOPE, ISSUE, false),
		).toEqual(own)
	})

	it('does not read an earlier invocation’s stop when this invocation’s scope is still empty', () => {
		const stale = { ...ship(3, KIND.SHIP_STOP, ISSUE), at: BEFORE }

		expect(
			run_event_scope.last_issue_event([EARLIER, stale], since(START), ISSUE, false),
		).toBeUndefined()
	})

	it('reads nothing without a scope when no supervisor of its own is on the stream', () => {
		expect(
			run_event_scope.last_issue_event(MIXED, run_event_scope.UNKNOWN_EVENT_SCOPE, ISSUE, false),
		).toBeUndefined()
	})
})

// joshuafolkken/kit#3039: another lane's merge was read as a lane child's position under a carry scope,
// so `run:step` told a child that had not started implementing to stop — and the parent's stall, which
// names no issue, pointed it at `backlog:next` the same way.
function named(pos: number, kind: string, text: string): RunEvent {
	return { pos, at: AFTER, kind, text }
}

// The parent's strand carries the whole invocation, so its first issue reference can be the child's own.
const STRANDED = named(
	9,
	KIND.STRANDED,
	`Run stranded — backlogrun #${ISSUE} #3027 started ${START}`,
)
const FOREIGN_CUT = named(8, KIND.CUT, '#2994 cut (pre-gate)')

describe('run_event_scope.last_issue_event — the parent’s batch record', () => {
	const PLAN = named(3, KIND.PLAN, `planned #${ISSUE}`)
	const FOREIGN_MERGE = named(4, KIND.MERGE, '#3027 merged')
	const FOREIGN_MERGE_LABEL = 'another issue’s merge'
	const FOREIGN_OUTAGE = named(5, KIND.OUTAGE, '#3027 outage (re-dispatchable)')
	const STALL = named(6, KIND.STALL, '1 ready, 6 free lane(s), 22m since the last dispatch')

	it.each([
		[FOREIGN_MERGE_LABEL, FOREIGN_MERGE],
		['another issue’s outage', FOREIGN_OUTAGE],
		['the parent’s stall', STALL],
		['another lane’s cut', FOREIGN_CUT],
		['the parent’s strand, whose invocation names it', STRANDED],
	])('leaves %s out of a lane child’s position', (_label, foreign) => {
		expect(run_event_scope.last_issue_event([PLAN, foreign], since(START), ISSUE, true)).toEqual(
			PLAN,
		)
	})

	it.each([
		['plan', named(4, KIND.PLAN, `planned #${ISSUE}`)],
		['cut', named(4, KIND.CUT, `#${ISSUE} cut (pre-gate)`)],
		['merge', named(4, KIND.MERGE, `#${ISSUE} merged`)],
	])('reads a lane child’s own %s as its position', (_label, own) => {
		expect(run_event_scope.last_issue_event([STALL, own], since(START), ISSUE, true)).toEqual(own)
	})

	it.each([
		[FOREIGN_MERGE_LABEL, FOREIGN_MERGE],
		['the stall', STALL],
	])('keeps %s as the parent’s position, which it acts on', (_label, batch) => {
		expect(run_event_scope.last_issue_event([PLAN, batch], since(START), ISSUE, false)).toEqual(
			batch,
		)
	})
})

describe('run_event_scope.last_issue_event — a lane child’s attempt', () => {
	const OWN_OUTAGE = named(4, KIND.OUTAGE, `#${ISSUE} outage (re-dispatchable)`)
	const OWN_DISPATCH = named(7, KIND.CHILD_LAUNCH, `#${ISSUE} dispatched`)
	const ATTEMPT = [named(3, KIND.PLAN, `planned #${ISSUE}`), OWN_OUTAGE, OWN_DISPATCH]

	it('does not read the previous attempt’s outage once it is re-dispatched', () => {
		expect(run_event_scope.last_issue_event(ATTEMPT, since(START), ISSUE, true)).toBeUndefined()
	})

	it('reads the new attempt’s own events after its newest launch', () => {
		const replanned = named(8, KIND.PLAN, `planned #${ISSUE}`)

		expect(
			run_event_scope.last_issue_event([...ATTEMPT, replanned], since(START), ISSUE, true),
		).toEqual(replanned)
	})

	it('keeps its own outage when only another issue is launched after it', () => {
		const foreign_dispatch = named(7, KIND.CHILD_LAUNCH, '#3027 dispatched')

		expect(
			run_event_scope.last_issue_event([OWN_OUTAGE, foreign_dispatch], since(START), ISSUE, true),
		).toEqual(OWN_OUTAGE)
	})
})

// joshuafolkken/kit#3442: a child this run launched that closed without `run:merge` still owes its merge.
describe('run_event_scope.is_merge_owed', () => {
	const launch = named(1, KIND.CHILD_LAUNCH, `#${ISSUE} launched`)
	const merge = named(2, KIND.MERGE, `#${ISSUE} merged`)

	it('owes the merge of a launched child with no merge event', () => {
		expect(run_event_scope.is_merge_owed([launch], since(START), ISSUE)).toBe(true)
	})

	it('owes nothing once the child’s merge is recorded', () => {
		expect(run_event_scope.is_merge_owed([launch, merge], since(START), ISSUE)).toBe(false)
	})

	it('does not read another issue’s merge as this child’s', () => {
		const foreign = named(2, KIND.MERGE, '#2994 merged')

		expect(run_event_scope.is_merge_owed([launch, foreign], since(START), ISSUE)).toBe(true)
	})

	it('owes nothing for a child run:merge already parked or split', () => {
		const park = named(2, KIND.PARK, `#${ISSUE} parked (needs-decision)`)
		const split = named(2, KIND.SPLIT, `#${ISSUE} split`)

		expect(run_event_scope.is_merge_owed([launch, park], since(START), ISSUE)).toBe(false)
		expect(run_event_scope.is_merge_owed([launch, split], since(START), ISSUE)).toBe(false)
	})

	it('owes the merge of a child relaunched after its park', () => {
		const park = named(2, KIND.PARK, `#${ISSUE} parked`)
		const relaunch = named(3, KIND.CHILD_LAUNCH, `#${ISSUE} launched`)

		expect(run_event_scope.is_merge_owed([launch, park, relaunch], since(START), ISSUE)).toBe(true)
	})

	it('owes nothing for an issue this invocation never launched', () => {
		const stale = { ...launch, at: BEFORE }

		expect(run_event_scope.is_merge_owed([stale], since(START), ISSUE)).toBe(false)
	})

	it('owes nothing when the scope is undetermined', () => {
		expect(
			run_event_scope.is_merge_owed([launch], run_event_scope.UNKNOWN_EVENT_SCOPE, ISSUE),
		).toBe(false)
	})
})
