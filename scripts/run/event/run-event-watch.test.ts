import { describe, expect, it } from 'vitest'
import type { RunEvent, StreamRead } from './run-event-stream'
import { run_event_watch, type WatchPorts } from './run-event-watch'

// joshuafolkken/kit#2492: the relay path is one process writing to a pane, not a session woken per
// event. The loop is driven with scripted passes, so what it writes and the position it carries are
// pinned without a clock or a stream file.

function event_at(pos: number, kind: string): RunEvent {
	return { pos, at: '2026-09-24T05:31:00.000Z', kind, text: `#${String(pos)}` }
}

interface Harness {
	ports: WatchPorts
	lines: Array<string>
	asked: Array<number>
}

function harness(reads: ReadonlyArray<StreamRead>): Harness {
	const lines: Array<string> = []
	const asked: Array<number> = []
	let passes = 0

	return {
		lines,
		asked,
		ports: {
			pass: async (position) => {
				asked.push(position)
				const read = reads[passes] ?? { events: [], next_position: position }

				passes += 1
				await Promise.resolve()

				return read
			},
			write: (line) => {
				lines.push(line)
			},
			render: (event) => `${event.kind} ${event.text}`,
			should_continue: () => passes < reads.length,
		},
	}
}

describe('run_event_watch.watch — every arriving event is written by the script', () => {
	it('writes each event rendered, in stream order', async () => {
		const run = harness([
			{ events: [event_at(4, 'child-launch')], next_position: 4 },
			{ events: [event_at(5, 'merge'), event_at(6, 'park')], next_position: 6 },
		])

		await run_event_watch.watch(run.ports, 3)

		expect(run.lines).toStrictEqual(['child-launch #4', 'merge #5', 'park #6'])
	})

	it('asks each pass from the position the previous one returned', async () => {
		const run = harness([
			{ events: [event_at(4, 'merge')], next_position: 4 },
			{ events: [], next_position: 4 },
			{ events: [event_at(5, 'stop')], next_position: 5 },
		])

		expect(await run_event_watch.watch(run.ports, 3)).toBe(5)
		expect(run.asked).toStrictEqual([3, 4, 4])
	})

	it('writes nothing on a quiet pass', async () => {
		const run = harness([{ events: [], next_position: 3 }])

		await run_event_watch.watch(run.ports, 3)

		expect(run.lines).toStrictEqual([])
	})
})
