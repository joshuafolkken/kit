import { run_event_stream, type RunEvent } from '#scripts/run/run-event-stream'
import { describe, expect, it } from 'vitest'
import { backlog_stalled, type StallReading } from './backlog-stalled'

const THRESHOLD_MS = 600_000
const READY = 3
const FREE = 5
const OVER_THRESHOLD_MS = THRESHOLD_MS + 1
const UNDER_THRESHOLD_MS = THRESHOLD_MS - 1

function reading(overrides: Partial<StallReading>): StallReading {
	return { ready_count: READY, free_lanes: FREE, dispatch_age_ms: OVER_THRESHOLD_MS, ...overrides }
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
		expect(verdict_of({ dispatch_age_ms: THRESHOLD_MS })).toBe(backlog_stalled.OK)
	})

	it('is ok just before the threshold', () => {
		expect(verdict_of({ dispatch_age_ms: UNDER_THRESHOLD_MS })).toBe(backlog_stalled.OK)
	})

	it('is a stall just after the threshold', () => {
		expect(verdict_of({ dispatch_age_ms: OVER_THRESHOLD_MS })).toBe(backlog_stalled.STALLED)
	})
})

describe('backlog_stalled.dispatch_age_ms', () => {
	const NOW_MS = Date.parse('2026-09-22T12:20:00.000Z')

	it('ages from the newest dispatch event', () => {
		const events = [
			event(run_event_stream.EVENT_KIND.CHILD_LAUNCH, '2026-09-22T12:00:00.000Z', 0),
			event(run_event_stream.EVENT_KIND.CHILD_LAUNCH, '2026-09-22T12:10:00.000Z', 1),
		]

		expect(backlog_stalled.dispatch_age_ms(events, NOW_MS)).toBe(600_000)
	})

	it('ages from the first event when nothing has dispatched yet', () => {
		const events = [event(run_event_stream.EVENT_KIND.PLAN, '2026-09-22T12:05:00.000Z', 0)]

		expect(backlog_stalled.dispatch_age_ms(events, NOW_MS)).toBe(900_000)
	})

	it('is undefined for an empty stream', () => {
		expect(backlog_stalled.dispatch_age_ms([], NOW_MS)).toBeUndefined()
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
