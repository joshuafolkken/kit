import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_offline_spans } from './lane-offline-spans'

// joshuafolkken/kit#7867: the sampler's `offline` / `online` turns read back as outage intervals.

const MINUTE_MS = 60_000
const START = Date.parse('2026-11-18T00:00:00.000Z')
const OFFLINE = 'offline'
const STILL_OFFLINE = 'offline-tick'
const ONLINE = 'online'

function at(minute: number): number {
	return START + minute * MINUTE_MS
}

function turn(kind: string, minute: number): RunEvent {
	return { pos: minute, at: new Date(at(minute)).toISOString(), kind, text: kind }
}

describe('lane_offline_spans.spans', () => {
	it('pairs each outage with the recovery that ends it', () => {
		const down = [turn(OFFLINE, 1), turn(STILL_OFFLINE, 2), turn(STILL_OFFLINE, 3)]
		const events = [...down, turn(ONLINE, 4), turn('sleep', 5), turn(OFFLINE, 8)]

		expect(lane_offline_spans.spans([...events, turn(ONLINE, 9)])).toStrictEqual([
			{ from_ms: at(1), to_ms: at(4) },
			{ from_ms: at(8), to_ms: at(9) },
		])
	})

	it('ends an outage with no recovery one tick past its last sighting', () => {
		const events = [turn(OFFLINE, 2), turn(STILL_OFFLINE, 3), turn(STILL_OFFLINE, 4)]

		expect(lane_offline_spans.spans(events)).toStrictEqual([{ from_ms: at(2), to_ms: at(5) }])
	})

	it('never stretches an outage a stopped drive left open to a later recovery', () => {
		const events = [turn(OFFLINE, 2), turn('sleep', 30), turn(ONLINE, 90)]

		expect(lane_offline_spans.spans(events)).toStrictEqual([{ from_ms: at(2), to_ms: at(3) }])
	})

	it('starts a new outage at a sighting long after the stopped one', () => {
		const events = [turn(OFFLINE, 2), turn(STILL_OFFLINE, 40), turn(ONLINE, 41)]

		expect(lane_offline_spans.spans(events)).toStrictEqual([
			{ from_ms: at(2), to_ms: at(3) },
			{ from_ms: at(40), to_ms: at(41) },
		])
	})

	it('joins a repeated offline turn, as two samplers would write, into one outage', () => {
		const events = [turn(ONLINE, 0), turn(OFFLINE, 1), turn(OFFLINE, 2), turn(ONLINE, 3)]

		expect(lane_offline_spans.spans(events)).toStrictEqual([{ from_ms: at(1), to_ms: at(3) }])
	})
})

// joshuafolkken/kit#7895: the board reads when the outage still open began, and which kinds are turns.
describe('lane_offline_spans.open_since', () => {
	it('reads the start of an outage with no recovery, and none once recovered', () => {
		const down = [turn(OFFLINE, 1), turn(STILL_OFFLINE, 2)]

		expect(lane_offline_spans.open_since(down)).toBe(at(1))
		expect(lane_offline_spans.open_since([...down, turn(ONLINE, 3)])).toBeUndefined()
		expect(lane_offline_spans.open_since([])).toBeUndefined()
	})

	it('reads the first sighting left when the offline turn itself is gone', () => {
		expect(lane_offline_spans.open_since([turn(STILL_OFFLINE, 5), turn(STILL_OFFLINE, 6)])).toBe(
			at(5),
		)
	})

	it('names the connection turns alone', () => {
		const kinds = [OFFLINE, STILL_OFFLINE, ONLINE, 'sleep']

		expect(kinds.map((kind) => lane_offline_spans.is_turn(kind))).toStrictEqual([
			true,
			true,
			true,
			false,
		])
	})
})

describe('lane_offline_spans.ends_online', () => {
	it('reads no turn as online', () => {
		expect(lane_offline_spans.ends_online([])).toBe(true)
	})

	it('reads the last turn', () => {
		expect(lane_offline_spans.ends_online([turn(OFFLINE, 1)])).toBe(false)
		expect(lane_offline_spans.ends_online([turn(OFFLINE, 1), turn(ONLINE, 2)])).toBe(true)
	})
})
