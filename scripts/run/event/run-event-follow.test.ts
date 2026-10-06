import { describe, expect, it } from 'vitest'
import { run_event_follow, type FollowPorts } from './run-event-follow'
import type { RunEvent, StreamRead } from './run-event-stream'

// joshuafolkken/kit#2207: the bounded follow pass an attached session relays with. The stream is driven
// by injected ports, so the two behaviors the acceptance criterion names are pinned deterministically:
// it returns the moment an event is past the caller's position (the arrival relay), and it returns at
// the interval when none is (the quiet tick) — and both answer the same regardless of who is reading,
// which is the cut invariant.

const OPTIONS = { interval_ms: 100, tick_ms: 5 }
const AT = '2026-09-21T00:00:00.000Z'

function event(pos: number, text: string): RunEvent {
	return { pos, at: AT, kind: 'merge', text }
}

// A clock that advances by the tick each time it is asked to sleep, and a stream whose events appear
// after a set number of reads — enough to exercise arrival and the interval without a real wait.
function ports(events: ReadonlyArray<RunEvent>, appear_after_reads: number): FollowPorts {
	let clock = 0
	let reads = 0

	return {
		read: (position): StreamRead => {
			const visible = reads >= appear_after_reads ? events : []

			reads += 1

			return {
				events: visible.filter((candidate) => candidate.pos > position),
				next_position: visible.at(-1)?.pos ?? position,
			}
		},
		now: () => clock,
		sleep: async (milliseconds): Promise<void> => {
			clock += milliseconds
		},
	}
}

describe('run_event_follow.follow — arrival', () => {
	it('returns as soon as an event is past the position, without waiting the interval', async () => {
		const read = await run_event_follow.follow(ports([event(1, 'merged')], 0), 0, OPTIONS)

		expect(read.events.map((each) => each.text)).toStrictEqual(['merged'])
		expect(read.next_position).toBe(1)
	})

	it('relays only what is past the caller position — a later reader is not fed the earlier events', async () => {
		const stream = [event(1, 'planned'), event(2, 'merged')]

		const read = await run_event_follow.follow(ports(stream, 0), 1, OPTIONS)

		expect(read.events.map((each) => each.text)).toStrictEqual(['merged'])
	})

	it('waits, then returns the event that arrives before the interval runs out', async () => {
		const read = await run_event_follow.follow(ports([event(5, 'late')], 3), 0, OPTIONS)

		expect(read.events.map((each) => each.text)).toStrictEqual(['late'])
	})
})

describe('run_event_follow.follow — the quiet tick', () => {
	it('returns at the interval with no events when nothing has been appended', async () => {
		const read = await run_event_follow.follow(ports([], 0), 0, OPTIONS)

		expect(read.events).toHaveLength(0)
		expect(read.next_position).toBe(0)
	})

	it('holds the caller position across a quiet tick', async () => {
		const read = await run_event_follow.follow(ports([], 0), 7, OPTIONS)

		expect(read.next_position).toBe(7)
	})
})
