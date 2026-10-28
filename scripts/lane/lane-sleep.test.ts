import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { afterAll, describe, expect, it } from 'vitest'
import { lane_sleep } from './lane-sleep'

// joshuafolkken/kit#5032: a sampler tick later than a few intervals is the host's sleep, recorded on the
// run stream as one event and read back as the span every lane's net time takes out.

const INTERVAL_MS = 60_000
const START = Date.parse('2026-10-26T12:00:00.000Z')
const scratch = mkdtempSync(path.join(tmpdir(), 'lane-sleep-test-'))

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('lane_sleep.gap_of', () => {
	it('reads a tick within three intervals as on time, however slow', () => {
		expect(lane_sleep.gap_of(START, START + 3 * INTERVAL_MS, INTERVAL_MS)).toBeUndefined()
	})

	it('reads a later tick as a sleep from the tick that was due', () => {
		const now_ms = START + 30 * INTERVAL_MS

		expect(lane_sleep.gap_of(START, now_ms, INTERVAL_MS)).toStrictEqual({
			from_ms: START + INTERVAL_MS,
			to_ms: now_ms,
		})
	})
})

describe('lane_sleep.record', () => {
	it('writes a sleep that spans reads back whole', async () => {
		const events_path = path.join(scratch, 'events.jsonl')
		const span = { from_ms: START, to_ms: START + 29 * INTERVAL_MS }

		await lane_sleep.record(span, events_path)
		const events = run_event_stream.read_events(events_path)

		expect(events.map((event) => event.text)).toStrictEqual(['host slept 29.0 min'])
		expect(lane_sleep.spans(events)).toStrictEqual([span])
	})
})
