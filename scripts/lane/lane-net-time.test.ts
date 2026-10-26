import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_net_time } from './lane-net-time'

// joshuafolkken/kit#4749: a lane's net time is its dispatch-to-merge time less the waits it stood
// on a person or an outage, each until the lane resumed; a ship stop's wait is the fix, so it stays in.

const ISSUE = 4695
const OTHER = 4696
const MINUTE_MS = 60_000
const OTHER_REDISPATCH = 20
const START = Date.parse('2026-10-24T03:00:00.000Z')

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function dispatch(minute: number, issue = ISSUE): LedgerEntry {
	return { kind: 'dispatch', at: at(minute), issue }
}

function merge(minute: number): LedgerEntry {
	return { kind: 'merge', at: at(minute), issue: ISSUE }
}

function stop(minute: number, issue = ISSUE): LedgerEntry {
	return { kind: 'stop', at: at(minute), issue, reason: 'review' }
}

// A ship stage that started at `minute` and ran one.
function stage(minute: number): LedgerEntry {
	return { kind: 'stage', at: at(minute + 1), stage: 'gate', elapsed_ms: MINUTE_MS, issue: ISSUE }
}

function event(minute: number, kind: string, text: string): RunEvent {
	return { pos: minute, at: at(minute), kind, text }
}

function net_minutes(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent> = [],
): number | undefined {
	const net = lane_net_time.net_ms(entries, events, ISSUE)

	return net === undefined ? undefined : net / MINUTE_MS
}

describe('lane_net_time.net_ms', () => {
	it('is the dispatch-to-merge time when the lane never stopped', () => {
		expect(net_minutes([dispatch(0), stop(5, OTHER), merge(30)])).toBe(30)
	})

	it('takes out a park waiting on a person until the re-dispatch, but not the ship stop before it', () => {
		const entries = [dispatch(0), stop(20), dispatch(50), merge(64)]
		const park = event(25, 'park', `#${String(ISSUE)} parked`)

		expect(net_minutes(entries, [park])).toBe(39)
	})

	it('takes out an outage until the re-dispatch', () => {
		const entries = [dispatch(0), dispatch(40), merge(55)]
		const outage = event(10, 'outage', `#${String(ISSUE)} outage (re-dispatchable)`)

		expect(net_minutes(entries, [outage])).toBe(25)
	})

	it('takes out a usage-limit stop until the re-dispatch after the reset', () => {
		const entries = [dispatch(0), dispatch(40), merge(55)]
		const text = `#${String(ISSUE)} usage limit — resumes at ${at(38)}`

		expect(net_minutes(entries, [event(10, 'usage-limit', text)])).toBe(25)
	})

	it('keeps a ship stop, whose wait the relaunched child spends on the fix', () => {
		expect(net_minutes([dispatch(0), stop(10), stage(18), merge(30)])).toBe(30)
	})
})

// joshuafolkken/kit#5032: a host sleep the sampler recorded at the wake, `minutes` long from `minute`.
function sleep(minute: number, minutes: number): RunEvent {
	return { ...event(minute + minutes, 'sleep', 'host slept'), elapsed_ms: minutes * MINUTE_MS }
}

describe('lane_net_time.net_ms — host sleep', () => {
	it('takes out a host sleep inside the lane, whatever issue the lane is', () => {
		expect(net_minutes([dispatch(0), merge(55)], [sleep(10, 15)])).toBe(40)
	})

	it('takes out only the part of a host sleep inside the lane', () => {
		expect(net_minutes([dispatch(0), merge(55)], [sleep(50, 15)])).toBe(50)
	})

	it('takes out a park the host slept through once', () => {
		const park = event(10, 'park', `#${String(ISSUE)} parked`)

		expect(net_minutes([dispatch(0), dispatch(40), merge(60)], [park, sleep(20, 30)])).toBe(20)
	})
})

describe('lane_net_time.net_ms — where a wait ends', () => {
	it('ends a park at the next ship stage', () => {
		const park = event(10, 'park', `#${String(ISSUE)} parked`)

		expect(net_minutes([dispatch(0), stage(18), merge(30)], [park])).toBe(22)
	})

	it('ends a park at a later outage, so the two waits do not overlap', () => {
		const park = event(10, 'park', `#${String(ISSUE)} parked`)
		const outage = event(20, 'outage', `#${String(ISSUE)} outage (re-dispatchable)`)

		expect(net_minutes([dispatch(0), dispatch(40), merge(50)], [park, outage])).toBe(20)
	})

	it("ignores another issue's park", () => {
		const park = event(10, 'park', `#${String(OTHER)} parked`)

		expect(net_minutes([dispatch(0), dispatch(OTHER_REDISPATCH, OTHER), merge(30)], [park])).toBe(
			30,
		)
	})

	it('cuts a park nothing resumed at the merge', () => {
		const park = event(25, 'park', `#${String(ISSUE)} parked`)

		expect(net_minutes([dispatch(0), merge(30)], [park])).toBe(25)
	})

	it('has no net time before the lane merged', () => {
		expect(net_minutes([dispatch(0), stop(10)])).toBeUndefined()
	})

	// joshuafolkken/kit#4995: the check moved into `span_of`, which the breakdown reads too.
	it('has no net time, nor a span, when the merge precedes the dispatch', () => {
		const entries = [merge(0), dispatch(10)]

		expect(net_minutes(entries)).toBeUndefined()
		expect(lane_net_time.span_of(entries, ISSUE)).toBeUndefined()
	})
})

describe('lane_net_time.net_minutes', () => {
	it('rounds a part minute up', () => {
		const entries = [dispatch(0), { kind: 'merge', at: at(40.5), issue: ISSUE } as const]

		expect(lane_net_time.net_minutes(entries, [], ISSUE)).toBe(41)
	})

	it('has no minutes before the lane merged', () => {
		expect(lane_net_time.net_minutes([dispatch(0)], [], ISSUE)).toBeUndefined()
	})
})

// joshuafolkken/kit#4995: the waits net time takes out are the intervals the breakdown excludes.
describe('lane_net_time.waits', () => {
	it('returns each park from its hold to the re-dispatch that ended it', () => {
		const entries = [dispatch(0), dispatch(50), merge(64)]
		const span = lane_net_time.span_of(entries, ISSUE)
		const park = event(25, 'park', `#${String(ISSUE)} parked`)

		expect(span).toBeDefined()
		expect(lane_net_time.waits(entries, [park], ISSUE, span ?? { from_ms: 0, to_ms: 0 })).toEqual([
			{ from_ms: Date.parse(at(25)), to_ms: Date.parse(at(50)) },
		])
	})

	it("cuts a wait nothing resumed at the span's end, and leaves a hold outside the span out", () => {
		const span = { from_ms: Date.parse(at(0)), to_ms: Date.parse(at(30)) }
		const parks = [25, 40].map((minute) => event(minute, 'park', `#${String(ISSUE)} parked`))

		expect(lane_net_time.waits([dispatch(0), merge(30)], parks, ISSUE, span)).toEqual([
			{ from_ms: Date.parse(at(25)), to_ms: Date.parse(at(30)) },
		])
	})
})

// joshuafolkken/kit#4818: a merged lane with no net time says why on its board row.
describe('lane_net_time.missing_reason', () => {
	it('names a missing dispatch', () => {
		expect(lane_net_time.missing_reason([dispatch(0, OTHER), merge(30)], ISSUE)).toBe('no dispatch')
	})

	it('names a missing merge', () => {
		expect(lane_net_time.missing_reason([dispatch(0)], ISSUE)).toBe('no merge')
	})

	it('names neither when the merge precedes the dispatch', () => {
		expect(lane_net_time.missing_reason([merge(0), dispatch(10)], ISSUE)).toBe('cause unknown')
	})
})
