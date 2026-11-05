import { describe, expect, it } from 'vitest'
import type { QuotaReading } from './run-board-quota-read'
import { run_board_quota_spent } from './run-board-quota-spent'

const { claude_done, codex_done, per_lane_of, per_task_of, span_of } = run_board_quota_spent
const FIVE_HOURS = 300
const SEVEN_DAYS = 10_080
const RESET_MS = 1_800_000_000_000
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const HOURS = [5, 4, 3, 2, 1]

interface Task {
	span: ReadonlyArray<QuotaReading>
	lane: string | undefined
}

function reading(five_hour: number, seven_day: number, shift_ms = 0): QuotaReading {
	return {
		windows: [
			{ minutes: FIVE_HOURS, used_percent: five_hour, resets_ms: RESET_MS + shift_ms },
			{ minutes: SEVEN_DAYS, used_percent: seven_day, resets_ms: RESET_MS },
		],
		taken_ms: undefined,
	}
}

// A 7d reading of `used` percent taken `hour` hours in.
function week(used: number, hour: number): QuotaReading {
	return {
		windows: [{ minutes: SEVEN_DAYS, used_percent: used, resets_ms: RESET_MS }],
		taken_ms: hour * HOUR_MS,
	}
}

// Five done files in newest-first order, each observing the same shared rise.
function rollouts(lane: string | undefined): Array<Task> {
	return HOURS.map((hour) => ({ span: [week(0, 0), week(10, hour)], lane }))
}

// One done file's span: a head reading and a tail reading of the same meters.
function file(from: [number, number], to: [number, number]): ReadonlyArray<QuotaReading> {
	return span_of([reading(...from)], reading(...to))
}

describe('run_board_quota_spent.span_of', () => {
	it("holds a done file's head readings, oldest first, then its tail", () => {
		const heads = [reading(10, 40), reading(12, 41)]

		expect(span_of(heads, reading(16, 42))).toEqual([...heads, reading(16, 42)])
	})

	it('holds nothing for a file whose tail holds no reading', () => {
		expect(span_of([reading(10, 40)], undefined)).toEqual([])
	})
})

describe('run_board_quota_spent.claude_done and codex_done', () => {
	const tool_line = JSON.stringify({ type: 'user' })
	const claude_end = JSON.stringify({ type: 'result', stop_reason: 'end_turn' })
	const codex_end = JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } })
	const codex_turn = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count' } })

	it('reads a file as done when its last line ends the session or turn', () => {
		expect(claude_done(`${tool_line}\n${claude_end}\n`)).toBe(true)
		expect(codex_done(`${codex_turn}\n${codex_end}`)).toBe(true)
	})

	it('reads a file written past its end line, or holding none, as not done', () => {
		expect(claude_done(`${claude_end}\n${tool_line}`)).toBe(false)
		expect(codex_done(`${codex_end}\n${codex_turn}`)).toBe(false)
		expect(claude_done('')).toBe(false)
		expect(codex_done(claude_end)).toBe(false)
		expect(claude_done(codex_end)).toBe(false)
	})
})

describe('run_board_quota_spent.per_task_of', () => {
	it('shares the meter rise of two concurrent lanes between them, not counting it twice', () => {
		const spans = [file([10, 40], [16, 46]), file([10, 40], [16, 46])]

		expect(per_task_of(spans)).toEqual({ [FIVE_HOURS]: 3, [SEVEN_DAYS]: 3 })
	})

	it('shares the meter rise of three overlapping lanes, a third each where each saw it all', () => {
		const spans = [file([12, 41], [19, 49]), file([10, 40], [18, 48]), file([11, 40], [17, 47])]

		expect(per_task_of(spans)).toEqual({ [FIVE_HOURS]: 3, [SEVEN_DAYS]: 3 })
	})

	it('reads lanes run one after another as the mean of their rises, a spend of none included', () => {
		const spans = [file([16, 43], [16, 43]), file([7, 41], [16, 43]), file([2, 40], [7, 41])]

		expect(per_task_of(spans)).toEqual({ [FIVE_HOURS]: 14 / 3, [SEVEN_DAYS]: 1 })
	})

	it("measures a window that reset from the newest file's last reset only", () => {
		const shift_ms = FIVE_HOURS * MINUTE_MS
		const after = span_of([reading(2, 41, shift_ms)], reading(5, 42, shift_ms))
		const across = span_of([reading(80, 40), reading(1, 40, shift_ms)], reading(2, 41, shift_ms))
		const before = file([60, 38], [80, 40])

		expect(per_task_of([after, across, before])).toEqual({ [FIVE_HOURS]: 2, [SEVEN_DAYS]: 4 / 3 })
	})

	it('counts a done file whose head holds no reading as a task done', () => {
		const spans = [span_of([], reading(16, 46)), file([10, 40], [16, 46])]

		expect(per_task_of(spans)).toEqual({ [FIVE_HOURS]: 3, [SEVEN_DAYS]: 3 })
	})

	it('reads a reset that only jittered as the same window', () => {
		const spans = [span_of([reading(10, 40)], reading(13, 40, MINUTE_MS))]

		expect(per_task_of(spans)).toEqual({ [FIVE_HOURS]: 3 })
	})

	it('tells nothing where no file holds a reading, or none of the windows rose', () => {
		expect(per_task_of([[], []])).toEqual({})
		expect(per_task_of([])).toEqual({})
		expect(per_task_of([file([4, 40], [4, 40]), file([4, 40], [4, 40])])).toEqual({})
	})
})

describe('run_board_quota_spent.per_task_of over the lanes done in its rise', () => {
	it("divides a resumed lane's rise from its first launch by the lanes done since, not the sample", () => {
		const newest = span_of([week(44, 10)], week(45, 11))
		const resumed = span_of([week(25, 0)], week(41, 9))
		const older = span_of([week(42, 9)], week(43, 10))
		const ends = [11, 9, 10, 1, 2, 3, 4, 5, 6, 7, 8, 8].map((hour) => hour * HOUR_MS)

		expect(per_task_of([newest, resumed, older], ends)).toEqual({ [SEVEN_DAYS]: 20 / 12 })
	})

	it('divides by the sample where the lanes done in its rise are the sample itself', () => {
		const spans = [span_of([week(41, 2)], week(43, 3)), span_of([week(40, 1)], week(41, 2))]
		const ends = [3, 2].map((hour) => hour * HOUR_MS)

		expect(per_task_of(spans, ends)).toEqual({ [SEVEN_DAYS]: 3 / 2 })
		expect(per_task_of(spans)).toEqual({ [SEVEN_DAYS]: 3 / 2 })
	})
})

describe('run_board_quota_spent.per_lane_of', () => {
	it('counts five completed rollouts of one lane as one task', () => {
		const tasks = rollouts('6376')
		const ends = HOURS.map((hour) => ({ end_ms: hour * HOUR_MS, lane: '6376' }))

		expect(per_lane_of(tasks, ends)).toEqual({ [SEVEN_DAYS]: 10 })
		expect(per_lane_of(tasks, [])).toEqual({ [SEVEN_DAYS]: 10 })
	})

	it('counts rollouts without lanes individually, including an untimed sample', () => {
		const tasks = rollouts(undefined)
		const ends = HOURS.map((hour) => ({ end_ms: hour * HOUR_MS, lane: undefined }))

		expect(per_lane_of(tasks, ends)).toEqual({ [SEVEN_DAYS]: 2 })
		expect(per_lane_of(tasks, [])).toEqual({ [SEVEN_DAYS]: 2 })
	})

	it('uses the latest done rollout of each lane across all files read back', () => {
		const tasks = [{ span: [week(0, 0), week(10, 10)], lane: 'sample' }]
		const ends = [
			{ end_ms: 20 * HOUR_MS, lane: 'later' },
			{ end_ms: HOUR_MS, lane: 'later' },
			{ end_ms: 5 * HOUR_MS, lane: 'finished' },
			{ end_ms: 6 * HOUR_MS, lane: 'finished' },
		]

		expect(per_lane_of(tasks, ends)).toEqual({ [SEVEN_DAYS]: 10 })
	})

	it('keeps the newest rollout reset when joining spans for the same lane', () => {
		const reset = FIVE_HOURS * MINUTE_MS
		const tasks = [
			{ span: [reading(0, 0, reset), reading(10, 10, reset)], lane: '6376' },
			{ span: [reading(80, 0), reading(90, 0)], lane: '6376' },
		]

		expect(per_lane_of(tasks, [])).toEqual({ [FIVE_HOURS]: 10, [SEVEN_DAYS]: 10 })
	})
})
