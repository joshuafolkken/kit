import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_host_gaps } from './lane-host-gaps'

// joshuafolkken/kit#7866: the host's stops every lane's time leaves out, read once for `josh lane:net`
// and the board alike.

const MINUTE_MS = 60_000
const START = Date.parse('2026-11-18T00:00:00.000Z')

function at(minute: number): number {
	return START + minute * MINUTE_MS
}

// A sleep from `from` to `to`, minutes past `START`, as the sampler writes it: stamped at the wake.
function sleep(from: number, to: number): RunEvent {
	return {
		pos: from,
		at: new Date(at(to)).toISOString(),
		kind: run_event_stream.EVENT_KIND.SLEEP,
		text: 'host slept',
		elapsed_ms: (to - from) * MINUTE_MS,
	}
}

function span(from: number, to: number): { from_ms: number; to_ms: number } {
	return { from_ms: at(from), to_ms: at(to) }
}

describe('lane_host_gaps.gaps_of', () => {
	it('joins overlapping sleeps into one stop', () => {
		const gaps = lane_host_gaps.gaps_of([sleep(10, 20), sleep(15, 30), sleep(40, 45)])

		expect(gaps).toStrictEqual([span(10, 30), span(40, 45)])
	})
})

// joshuafolkken/kit#7867: an outage is a stop beside the sleeps.
function turn(kind: 'offline' | 'offline-tick' | 'online', minute: number): RunEvent {
	return { pos: minute, at: new Date(at(minute)).toISOString(), kind, text: kind }
}

// The sampler's `offline` turn at `from`, then an `offline-tick` each minute to `to`.
function down(from: number, to: number): Array<RunEvent> {
	const ticks = Array.from({ length: to - from }, (_, index) =>
		turn('offline-tick', from + index + 1),
	)

	return [turn('offline', from), ...ticks]
}

describe('lane_host_gaps.gaps_of — network outages', () => {
	it('joins an outage with a sleep it overlaps, counting the overlap once', () => {
		const gaps = lane_host_gaps.gaps_of([...down(5, 9), sleep(8, 20), turn('online', 20)])

		expect(lane_host_gaps.excluded_ms(gaps, [span(0, 60)])).toBe(15 * MINUTE_MS)
	})

	it('cuts an outage still open at the end of the span asked for', () => {
		const gaps = lane_host_gaps.gaps_of(down(50, 59))

		expect(lane_host_gaps.excluded_ms(gaps, [span(0, 60)])).toBe(10 * MINUTE_MS)
	})
})

describe('lane_host_gaps.excluded_ms', () => {
	const gaps = lane_host_gaps.gaps_of([sleep(10, 20), sleep(15, 30)])

	it('counts overlapping sleeps once', () => {
		expect(lane_host_gaps.excluded_ms(gaps, [span(0, 60)])).toBe(20 * MINUTE_MS)
	})

	it('cuts a sleep at the span it crosses', () => {
		expect(lane_host_gaps.excluded_ms(gaps, [span(25, 60)])).toBe(5 * MINUTE_MS)
	})

	it('counts none of a sleep outside the span', () => {
		expect(lane_host_gaps.excluded_ms(gaps, [span(30, 60)])).toBe(0)
	})

	it('sums the stops inside each span', () => {
		expect(lane_host_gaps.excluded_ms(gaps, [span(0, 12), span(28, 60)])).toBe(4 * MINUTE_MS)
	})
})
