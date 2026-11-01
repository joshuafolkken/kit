import { describe, expect, it } from 'vitest'
import type { QuotaReading } from './run-board-quota-read'
import { run_board_quota_spent } from './run-board-quota-spent'

const { claude_done, codex_done, per_task_of, span_of } = run_board_quota_spent
const FIVE_HOURS = 300
const SEVEN_DAYS = 10_080
const RESET_MS = 1_800_000_000_000
const MINUTE_MS = 60_000

function reading(five_hour: number, seven_day: number, shift_ms = 0): QuotaReading {
	return {
		windows: [
			{ minutes: FIVE_HOURS, used_percent: five_hour, resets_ms: RESET_MS + shift_ms },
			{ minutes: SEVEN_DAYS, used_percent: seven_day, resets_ms: RESET_MS },
		],
		taken_ms: undefined,
	}
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
