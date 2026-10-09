import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { backlog_arrival_added } from './backlog-arrival-added'

// joshuafolkken/kit#3433: the `add` event `run:add` writes is what ends the parent's `--wait` early.

const SINCE = '2026-10-09T01:00:00.000Z'
const SINCE_MS = Date.parse(SINCE)

function event_of(kind: string, at: string): RunEvent {
	return { pos: 1, at, kind, text: 'added #3432' }
}

describe('backlog_arrival_added.has_added_since', () => {
	it('sees an add event written at or after the instant', () => {
		const events = [event_of(run_event_stream.EVENT_KIND.ADD, SINCE)]

		expect(backlog_arrival_added.has_added_since(events, SINCE_MS)).toBe(true)
	})

	it('ignores an add event written before the instant', () => {
		const events = [event_of(run_event_stream.EVENT_KIND.ADD, '2026-10-09T00:59:59.000Z')]

		expect(backlog_arrival_added.has_added_since(events, SINCE_MS)).toBe(false)
	})

	it('ignores every other kind', () => {
		const events = [event_of(run_event_stream.EVENT_KIND.NOTE, SINCE)]

		expect(backlog_arrival_added.has_added_since(events, SINCE_MS)).toBe(false)
	})
})

async function failing(): Promise<ReadonlyArray<RunEvent>> {
	throw new Error('unreadable')
}

describe('backlog_arrival_added.is_added_since', () => {
	it('reads a stream that cannot be read as no addition', async () => {
		await expect(backlog_arrival_added.is_added_since(SINCE_MS, failing)).resolves.toBe(false)
	})
})
