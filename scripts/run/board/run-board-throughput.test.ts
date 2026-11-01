import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import { run_board_throughput, type ThroughputRow } from './run-board-throughput'

// joshuafolkken/kit#5708: the throughput cells are read from the run's event stream on the local clock,
// so every instant here is built from local hours of 2026-11-01 (a negative hour is the day before).

const KIND = run_event_stream.EVENT_KIND
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const BEAT = 10 * MINUTE
const YEAR = 2026
const NOVEMBER = 10
const FIRST = 1

function local(hour: number, minute = 0): number {
	return new Date(YEAR, NOVEMBER, FIRST, hour, minute).getTime()
}

const NOW = local(10, 30)
const EIGHT = local(8)
const NINE = local(9)
const HALF_PAST_NINE = local(9, 30)

function event(ms: number, kind: string, text = ''): RunEvent {
	return { pos: 0, at: new Date(ms).toISOString(), kind, text }
}

function beats(from_ms: number, to_ms: number): ReadonlyArray<RunEvent> {
	const count = Math.floor((to_ms - from_ms) / BEAT) + 1

	return Array.from({ length: count }, (_, index) => event(from_ms + index * BEAT, KIND.HEARTBEAT))
}

function stream(...events: ReadonlyArray<RunEvent>): ReadonlyArray<RunEvent> {
	return events
		.toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at))
		.map((item, index) => ({ ...item, pos: index + 1 }))
}

function rows(events: ReadonlyArray<RunEvent>): readonly [ThroughputRow, ThroughputRow] {
	const [day, week] = run_board_throughput.rows_of(events, NOW)

	if (day === undefined || week === undefined) throw new Error('expected the 24h and 7d rows')

	return [day, week]
}

function active_at(row: ThroughputRow, start_ms: number): number | undefined {
	return row.cells.find((cell) => cell.start_ms === start_ms)?.active_ms
}

describe('run_board_throughput cells', () => {
	it('derives 24 hourly cells and 14 half-day cells, the newest holding now', () => {
		const [day, week] = rows([])

		expect(day.cells).toHaveLength(24)
		expect(day.cells.at(-1)).toMatchObject({ start_ms: local(10), end_ms: local(11) })
		expect(day.cells[0]).toMatchObject({ start_ms: local(-13) })
		expect(week.cells).toHaveLength(14)
		expect(week.cells.at(-1)).toMatchObject({ start_ms: local(0), end_ms: local(12) })
		expect(week.cells[0]).toMatchObject({ start_ms: local(-156) })
	})

	it('leaves a cell stopped throughout with no active time', () => {
		const [day] = rows(stream(...beats(EIGHT, NOW)))

		expect(active_at(day, local(7))).toBe(0)
		expect(active_at(day, NINE)).toBe(HOUR)
	})

	it("ends an active stretch at the run's own stop or stranding, never a child's", () => {
		const quiet = beats(HALF_PAST_NINE, NOW)
		const [run_stop] = rows(stream(event(NINE, KIND.STOP, 'run stopped'), ...quiet))
		const [stranded] = rows(stream(event(NINE, KIND.STRANDED, 'no lane left'), ...quiet))
		const [child_stop] = rows(stream(event(NINE, KIND.STOP, '#12 stopped'), ...quiet))

		expect(active_at(run_stop, NINE)).toBe(30 * MINUTE)
		expect(active_at(stranded, NINE)).toBe(30 * MINUTE)
		expect(active_at(child_stop, NINE)).toBe(HOUR)
	})
})

describe('run_board_throughput across a clock change', () => {
	it('keeps every 7d cell on 00:00 or 12:00 across the week daylight saving ends in', () => {
		// An emptied TZ reads as UTC, so vitest restores the zone, never by assigning ''.
		vi.stubEnv('TZ', 'America/New_York')

		try {
			const [, week] = run_board_throughput.rows_of([], new Date(YEAR, NOVEMBER, 3, 9).getTime())
			const hours = week?.cells.map((cell) => new Date(cell.start_ms).getHours())

			expect(new Set(hours)).toStrictEqual(new Set([0, 12]))
			expect(week?.window_ms).toBe(169 * HOUR)
		} finally {
			vi.unstubAllEnvs()
		}
	})
})

describe('run_board_throughput active figures', () => {
	it('keeps stopped time out of ACTIVE and the /h denominator', () => {
		const events = stream(
			...beats(local(8), local(8, 20)),
			...beats(local(9, 10), NOW),
			event(local(8, 10), KIND.MERGE, '#1'),
			event(local(9, 30), KIND.MERGE, '#2'),
			event(local(10, 15), KIND.MERGE, '#3'),
		)
		const [day] = rows(events)

		expect(active_at(day, local(8))).toBe(20 * MINUTE)
		expect(day.active_ms).toBe(100 * MINUTE)
		expect(day.window_ms).toBe(24 * HOUR)
		expect(day.per_hour).toBeCloseTo(2 / (70 / 60))
		expect(day.done).toBe(3)
	})
})

describe('run_board_throughput current cell and closes', () => {
	it('keeps the current cell out of the average and the peak, its count in NOW', () => {
		const events = stream(
			...beats(local(8), NOW),
			event(local(-11), KIND.MERGE, '#1'),
			event(local(8, 5), KIND.MERGE, '#2'),
			event(local(8, 15), KIND.MERGE, '#3'),
			...['#4', '#5', '#6'].map((issue) => event(local(10, 5), KIND.MERGE, issue)),
		)
		const [day, week] = rows(events)

		expect(day.now).toBe(3)
		expect(day.peak).toEqual({ done: 2, per_hour: 2, start_ms: local(8) })
		expect(day.per_hour).toBeCloseTo(3 / 2)
		expect(week.now).toBeUndefined()
		expect(week.peak).toEqual({ done: 1, per_hour: 1 / 12, start_ms: local(-12) })
		expect(week.window_ms).toBe(168 * HOUR)
	})

	it('counts as DONE the closes the done section draws merged, once per child', () => {
		const events = stream(
			event(local(9), KIND.MERGE, '#1'),
			event(local(9, 10), KIND.MEASURED, '#2'),
			event(local(9, 20), KIND.PARK, '#3'),
			event(local(9, 30), KIND.WITHDRAW, '#4'),
			event(local(9, 40), KIND.MERGE, '#1'),
		)

		expect(rows(events)[0].done).toBe(2)
	})
})
