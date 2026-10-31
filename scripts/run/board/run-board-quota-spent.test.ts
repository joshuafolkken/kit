import { describe, expect, it } from 'vitest'
import type { QuotaReading } from './run-board-quota-read'
import { run_board_quota_spent } from './run-board-quota-spent'

const { claude_done, codex_done, per_task_of, spent_of } = run_board_quota_spent
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

describe('run_board_quota_spent.spent_of', () => {
	it("reads each window's rise from a file's first reading to its last", () => {
		expect(spent_of(reading(10, 40), reading(16, 42))).toEqual({
			[FIVE_HOURS]: 6,
			[SEVEN_DAYS]: 2,
		})
	})

	it('tells nothing for a file holding one reading, or none at its head or tail', () => {
		const only = reading(10, 40)

		expect(spent_of(only, only)).toEqual({})
		expect(spent_of(undefined, only)).toEqual({})
		expect(spent_of(only, undefined)).toEqual({})
	})

	it('leaves out a window that reset between the readings, keeping one whose reset jittered', () => {
		const reset = spent_of(reading(80, 40), reading(5, 42, FIVE_HOURS * MINUTE_MS))
		const jittered = spent_of(reading(10, 40), reading(13, 40, MINUTE_MS))

		expect(reset).toEqual({ [SEVEN_DAYS]: 2 })
		expect(jittered).toEqual({ [FIVE_HOURS]: 3 })
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
	it("takes each window's median over the files that tell one", () => {
		const spends = [
			{ [FIVE_HOURS]: 2, [SEVEN_DAYS]: 1 },
			{ [FIVE_HOURS]: 9 },
			{ [FIVE_HOURS]: 4, [SEVEN_DAYS]: 3 },
		]

		expect(per_task_of(spends)).toEqual({ [FIVE_HOURS]: 4, [SEVEN_DAYS]: 2 })
	})

	it('tells nothing where no file tells a spend', () => {
		expect(per_task_of([{}, {}])).toEqual({})
		expect(per_task_of([])).toEqual({})
	})
})
