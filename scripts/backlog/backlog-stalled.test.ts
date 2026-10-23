import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { backlog_stalled, type StallReading } from './backlog-stalled'

const THRESHOLD_MS = 600_000
const READY = 3
const FREE = 5
const OVER_THRESHOLD_MS = THRESHOLD_MS + 1
const UNDER_THRESHOLD_MS = THRESHOLD_MS - 1
const NOON_ISO = '2026-09-22T12:00:00.000Z'
const FIVE_PAST_ISO = '2026-09-22T12:05:00.000Z'
const ELEVEN_ISO = '2026-09-22T11:00:00.000Z'
const MEMORY = 'memory'

function mark(at: string, is_offerable: boolean): LedgerEntry {
	return { kind: lane_ledger.KIND.OFFERABLE, at, is_offerable }
}

function reading(overrides: Partial<StallReading>): StallReading {
	return { ready_count: READY, free_lanes: FREE, waiting_ms: OVER_THRESHOLD_MS, ...overrides }
}

function verdict_of(overrides: Partial<StallReading>): string {
	return backlog_stalled.assess(reading(overrides), THRESHOLD_MS)
}

function event(kind: string, at: string, pos: number): RunEvent {
	return { pos, at, kind, text: '' }
}

describe('backlog_stalled.assess', () => {
	// The four acceptance cases: work with a free lane, work with no free lane, no work, and an
	// unreadable record.
	it('reports a stall when there is ready work, a free lane, and it has been idle', () => {
		expect(verdict_of({})).toBe(backlog_stalled.STALLED)
	})

	it('reports ok when ready work has no free lane to go into', () => {
		expect(verdict_of({ free_lanes: 0 })).toBe(backlog_stalled.OK)
	})

	it('reports ok when no work is ready to dispatch', () => {
		expect(verdict_of({ ready_count: 0 })).toBe(backlog_stalled.OK)
	})

	it('reports unreadable when the dispatch record could not be read', () => {
		expect(backlog_stalled.assess(undefined, THRESHOLD_MS)).toBe(backlog_stalled.UNREADABLE)
	})
})

describe('backlog_stalled.assess elapsed-time boundary', () => {
	it('is not yet a stall exactly at the threshold', () => {
		expect(verdict_of({ waiting_ms: THRESHOLD_MS })).toBe(backlog_stalled.OK)
	})

	it('is ok just before the threshold', () => {
		expect(verdict_of({ waiting_ms: UNDER_THRESHOLD_MS })).toBe(backlog_stalled.OK)
	})

	it('is a stall just after the threshold', () => {
		expect(verdict_of({ waiting_ms: OVER_THRESHOLD_MS })).toBe(backlog_stalled.STALLED)
	})
})

describe('backlog_stalled.dispatch_age_ms', () => {
	const NOW_MS = Date.parse('2026-09-22T12:20:00.000Z')

	it('ages from the newest dispatch event', () => {
		const events = [
			event(run_event_stream.EVENT_KIND.CHILD_LAUNCH, NOON_ISO, 0),
			event(run_event_stream.EVENT_KIND.CHILD_LAUNCH, '2026-09-22T12:10:00.000Z', 1),
		]

		expect(backlog_stalled.dispatch_age_ms(events, NOW_MS)).toBe(600_000)
	})

	it('ages from the first event when nothing has dispatched yet', () => {
		const events = [event(run_event_stream.EVENT_KIND.PLAN, FIVE_PAST_ISO, 0)]

		expect(backlog_stalled.dispatch_age_ms(events, NOW_MS)).toBe(900_000)
	})

	it('is undefined for an empty stream', () => {
		expect(backlog_stalled.dispatch_age_ms([], NOW_MS)).toBeUndefined()
	})

	// joshuafolkken/kit#2464: a run hours old that has just dispatched is not stalled — the launch record
	// `lane:dispatch` now writes is what the age is measured from.
	it('reads a run that just dispatched as not stalled, however old the run is', () => {
		const events = [
			event(run_event_stream.EVENT_KIND.PLAN, '2026-09-22T08:00:00.000Z', 0),
			event(run_event_stream.EVENT_KIND.MERGE, ELEVEN_ISO, 1),
			event(run_event_stream.EVENT_KIND.CHILD_LAUNCH, '2026-09-22T12:18:00.000Z', 2),
		]
		const age = backlog_stalled.dispatch_age_ms(events, NOW_MS) ?? Infinity

		expect(verdict_of({ waiting_ms: age })).toBe(backlog_stalled.OK)
	})
})

describe('backlog_stalled.open_offerable_ms', () => {
	const REFERENCE_MS = Date.parse(NOON_ISO)
	const OPENED_ISO = FIVE_PAST_ISO

	it('is the newest observation since the dispatch when it saw both', () => {
		const entries = [mark(OPENED_ISO, true)]

		expect(backlog_stalled.open_offerable_ms(entries, REFERENCE_MS)).toBe(Date.parse(OPENED_ISO))
	})

	it('is undefined once a later observation closed the episode', () => {
		const entries = [mark(OPENED_ISO, true), mark('2026-09-22T12:06:00.000Z', false)]

		expect(backlog_stalled.open_offerable_ms(entries, REFERENCE_MS)).toBeUndefined()
	})

	it('ignores an observation from before the last dispatch', () => {
		const entries = [mark(ELEVEN_ISO, true)]

		expect(backlog_stalled.open_offerable_ms(entries, REFERENCE_MS)).toBeUndefined()
	})
})

describe('backlog_stalled.open_hold', () => {
	const AT = NOON_ISO

	it("is the driver's open hold reason", () => {
		const entries: ReadonlyArray<LedgerEntry> = [
			{ kind: lane_ledger.KIND.HELD, at: AT, reason: MEMORY },
		]

		expect(backlog_stalled.open_hold(entries)).toBe(MEMORY)
	})

	it('is undefined once the hold was released', () => {
		const entries: ReadonlyArray<LedgerEntry> = [
			{ kind: lane_ledger.KIND.HELD, at: AT, reason: MEMORY },
			{ kind: lane_ledger.KIND.RELEASED, at: AT },
		]

		expect(backlog_stalled.open_hold(entries)).toBeUndefined()
	})
})

describe('backlog_stalled.describe', () => {
	it('names the hold reason so a memory hold reads apart from a slow dispatch', () => {
		expect(backlog_stalled.describe(reading({ hold: MEMORY }))).toContain('(held: memory)')
	})

	it('names no hold when the driver holds none', () => {
		expect(backlog_stalled.describe(reading({}))).not.toContain('held')
	})
})

describe('backlog_stalled.count_ready_tokens', () => {
	it('counts the numeric issue lines and ignores verdict words', () => {
		expect(backlog_stalled.count_ready_tokens('2354\n2355\n2356')).toBe(READY)
	})

	it('is zero when the answer is a verdict word', () => {
		expect(backlog_stalled.count_ready_tokens('wait')).toBe(0)
	})
})
