import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_offline_spans } from './lane-offline-spans'

// joshuafolkken/kit#7867: the sampler's `offline` / `online` turns read back as outage intervals.

const MINUTE_MS = 60_000
const START = Date.parse('2026-11-18T00:00:00.000Z')

function at(minute: number): number {
	return START + minute * MINUTE_MS
}

function turn(kind: string, minute: number): RunEvent {
	return { pos: minute, at: new Date(at(minute)).toISOString(), kind, text: kind }
}

describe('lane_offline_spans.spans', () => {
	it('pairs each outage with the recovery that ends it', () => {
		const events = [turn('offline', 1), turn('online', 4), turn('sleep', 5), turn('offline', 8)]

		expect(lane_offline_spans.spans([...events, turn('online', 9)])).toStrictEqual([
			{ from_ms: at(1), to_ms: at(4) },
			{ from_ms: at(8), to_ms: at(9) },
		])
	})

	it('leaves an outage with no recovery open, ending at Infinity', () => {
		expect(lane_offline_spans.spans([turn('offline', 2)])).toStrictEqual([
			{ from_ms: at(2), to_ms: Infinity },
		])
	})

	it('drops a repeated turn, as two samplers would write', () => {
		const events = [turn('online', 0), turn('offline', 1), turn('offline', 2), turn('online', 3)]

		expect(lane_offline_spans.spans(events)).toStrictEqual([{ from_ms: at(1), to_ms: at(3) }])
	})
})

describe('lane_offline_spans.ends_online', () => {
	it('reads no turn as online', () => {
		expect(lane_offline_spans.ends_online([])).toBe(true)
	})

	it('reads the last turn', () => {
		expect(lane_offline_spans.ends_online([turn('offline', 1)])).toBe(false)
		expect(lane_offline_spans.ends_online([turn('offline', 1), turn('online', 2)])).toBe(true)
	})
})
