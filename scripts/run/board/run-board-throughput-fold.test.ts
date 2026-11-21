import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_throughput } from './run-board-throughput'
import { run_board_throughput_fold } from './run-board-throughput-fold'

// joshuafolkken/kit#8039: the throughput figures are folded on as the stream grows, and a stream folded
// in parts reads the same as the same stream folded whole.

const KIND = run_event_stream.EVENT_KIND
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const BEAT = 10 * MINUTE
const NOW = new Date(2026, 10, 20, 10, 30).getTime()
const RUN_STOP = 'run stopped'

function event(ms: number, kind: string, text = ''): RunEvent {
	return { pos: 0, at: new Date(ms).toISOString(), kind, text }
}

function beats(from_ms: number, to_ms: number): ReadonlyArray<RunEvent> {
	const count = Math.floor((to_ms - from_ms) / BEAT) + 1

	return Array.from({ length: count }, (_, index) => event(from_ms + index * BEAT, KIND.HEARTBEAT))
}

function numbered(events: ReadonlyArray<RunEvent>): ReadonlyArray<RunEvent> {
	return events.map((item, index) => ({ ...item, pos: index + 1 }))
}

function stream(...events: ReadonlyArray<RunEvent>): ReadonlyArray<RunEvent> {
	return numbered(events.toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at)))
}

// The same events as fresh objects, so the fold cannot take them for the held stream grown.
function copied(events: ReadonlyArray<RunEvent>): ReadonlyArray<RunEvent> {
	return events.map((item) => ({ ...item }))
}

// Nine days of a run: a stop and a restart, closes, a host sleep and a network outage.
function week_of_run(): ReadonlyArray<RunEvent> {
	return stream(
		...beats(NOW - 9 * DAY, NOW - 3 * DAY),
		event(NOW - 3 * DAY, KIND.STOP, RUN_STOP),
		...beats(NOW - 2 * DAY, NOW),
		event(NOW - 5 * DAY, KIND.MERGE, '#1'),
		event(NOW - 30 * HOUR, KIND.MERGE, '#2'),
		event(NOW - 2 * HOUR, KIND.PARK, '#3'),
		{ ...event(NOW - 20 * HOUR, KIND.SLEEP), elapsed_ms: 5 * MINUTE },
		event(NOW - 10 * HOUR, KIND.OFFLINE),
		event(NOW - 10 * HOUR + 3 * MINUTE, KIND.ONLINE),
	)
}

function whole_rows(
	events: ReadonlyArray<RunEvent>,
): ReturnType<typeof run_board_throughput.rows_of> {
	return run_board_throughput.rows_of(copied(events), NOW)
}

describe('run_board_throughput_fold folding on', () => {
	it('reads a stream given in parts the same as the stream given whole', () => {
		const events = week_of_run()

		for (const count of [1, 400, 401, 1000, 1500]) {
			run_board_throughput.rows_of(events.slice(0, count), NOW)
		}

		const parted = run_board_throughput.rows_of(events, NOW)

		expect(parted).toStrictEqual(whole_rows(events))
		expect(parted[1]?.done).toBe(2)
	})

	it('folds only the events past the held ones onto the held fold', () => {
		const events = week_of_run()
		const held = run_board_throughput_fold.fold_of(events.slice(0, 900))
		const grown = run_board_throughput_fold.fold_of(events)

		expect(grown).toBe(held)
		expect(grown.count).toBe(events.length)
		expect(run_board_throughput_fold.fold_of(events)).toBe(held)
	})
})

describe('run_board_throughput_fold folding whole again', () => {
	it('folds whole a stream that is not the held one grown', () => {
		const events = week_of_run()
		const held = run_board_throughput_fold.fold_of(events)

		expect(run_board_throughput_fold.fold_of(copied(events))).not.toBe(held)

		const kept = run_board_throughput_fold.fold_of(events)

		expect(run_board_throughput_fold.fold_of(events.toSpliced(5, 1))).not.toBe(kept)
		expect(run_board_throughput_fold.fold_of(events.slice(0, 10)).count).toBe(10)
	})

	it('folds whole on a line dated before the last folded one', () => {
		const events = week_of_run()
		const merge = event(NOW - 3 * HOUR, KIND.MERGE, '#4')
		const backdated = numbered([...events, merge])
		const held = run_board_throughput_fold.fold_of(backdated.slice(0, -1))

		expect(run_board_throughput_fold.fold_of(backdated)).not.toBe(held)
		expect(run_board_throughput.rows_of(backdated, NOW)).toStrictEqual(whole_rows(backdated))
		expect(whole_rows(backdated)[0]?.done).toBe(1)
	})
})

describe('run_board_throughput_fold retention', () => {
	it('lets go of what ended before the window, however long the stream', () => {
		const days = Array.from({ length: 30 }, (_, index) => NOW - (30 - index) * DAY)
		const events = stream(
			...days.flatMap((start_ms) => [
				...beats(start_ms, start_ms + 2 * HOUR),
				event(start_ms + 2 * HOUR, KIND.STOP, RUN_STOP),
				event(start_ms + HOUR, KIND.MERGE, `#${String(start_ms)}`),
			]),
		)
		const since_ms = NOW - DAY - run_board_throughput_fold.RETAIN_MS
		const fold = run_board_throughput_fold.fold_of(events)

		expect(fold.spans.length).toBeLessThanOrEqual(9)
		expect(fold.spans.every((span) => span.end_ms >= since_ms)).toBe(true)
		expect(fold.kept.length).toBeLessThanOrEqual(9)
		expect(run_board_throughput.rows_of(events, NOW)[1]?.done).toBe(6)
	})
})
