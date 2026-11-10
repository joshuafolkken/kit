import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import { backlog_arrival_added } from './backlog-arrival-added'

// joshuafolkken/kit#3433: the `add` event `run:add` writes is what ends the parent's `--wait` early.

const SINCE = '2026-10-09T01:00:00.000Z'
const SINCE_MS = Date.parse(SINCE)

function event_of(kind: string, at: string): RunEvent {
	return { pos: 1, at, kind, text: 'added #3432' }
}

const { ADD, LANE_LIMIT, NOTE } = run_event_stream.EVENT_KIND

describe('backlog_arrival_added.has_kind_since', () => {
	it('sees an add event written at or after the instant', () => {
		const events = [event_of(ADD, SINCE)]

		expect(backlog_arrival_added.has_kind_since(events, ADD, SINCE_MS)).toBe(true)
	})

	it('ignores an add event written before the instant', () => {
		const events = [event_of(ADD, '2026-10-09T00:59:59.000Z')]

		expect(backlog_arrival_added.has_kind_since(events, ADD, SINCE_MS)).toBe(false)
	})

	it('ignores every other kind', () => {
		const events = [event_of(NOTE, SINCE)]

		expect(backlog_arrival_added.has_kind_since(events, ADD, SINCE_MS)).toBe(false)
	})

	// joshuafolkken/kit#6861: a raise and an addition are told apart by kind.
	it.each([
		{ written: LANE_LIMIT, asked: ADD },
		{ written: ADD, asked: LANE_LIMIT },
	])('does not read a $written event as $asked', ({ written, asked }) => {
		const events = [event_of(written, SINCE)]

		expect(backlog_arrival_added.has_kind_since(events, asked, SINCE_MS)).toBe(false)
	})
})

async function failing(): Promise<ReadonlyArray<RunEvent>> {
	throw new Error('unreadable')
}

describe('backlog_arrival_added — an unreadable stream', () => {
	it('reads a stream that cannot be read as no addition', async () => {
		await expect(backlog_arrival_added.is_added_since(SINCE_MS, failing)).resolves.toBe(false)
	})

	it('reads a stream that cannot be read as no raise', async () => {
		await expect(backlog_arrival_added.is_raised_since(SINCE_MS, failing)).resolves.toBe(false)
	})
})

async function raised(): Promise<ReadonlyArray<RunEvent>> {
	return [event_of(LANE_LIMIT, SINCE)]
}

describe('backlog_arrival_added.is_raised_since', () => {
	it('sees a lane-limit event written at or after the instant', async () => {
		await expect(backlog_arrival_added.is_raised_since(SINCE_MS, raised)).resolves.toBe(true)
	})
})

// joshuafolkken/kit#7016: the addition and the raise question share one parse of the stream per tick.
describe('backlog_arrival_added.tick_reader', () => {
	it('reads the stream once for both questions of a tick', async () => {
		const read = vi.fn(raised)
		const tick = backlog_arrival_added.tick_reader(read)
		const added = await backlog_arrival_added.is_added_since(SINCE_MS, tick.read)
		const is_raised = await backlog_arrival_added.is_raised_since(SINCE_MS, tick.read)

		expect([added, is_raised]).toStrictEqual([false, true])
		expect(read).toHaveBeenCalledTimes(1)
	})

	it('reads the stream again once the next tick begins', async () => {
		const read = vi.fn(raised)
		const tick = backlog_arrival_added.tick_reader(read)

		await tick.read()
		tick.begin_tick()
		await tick.read()

		expect(read).toHaveBeenCalledTimes(2)
	})
})
