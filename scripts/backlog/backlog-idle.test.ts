import { describe, expect, it } from 'vitest'
import { backlog_budget, type BudgetInput } from './backlog-budget'
import { backlog_idle, type IdleWindow } from './backlog-idle'

// joshuafolkken/kit#3430: the idle watch's window is computed and written in one place, so the budget
// that measures it, the offer that records it and the board that reads it never disagree.

const MINUTE_MS = backlog_budget.MS_PER_MINUTE
const MINUTES_PER_HOUR = 60
const STARTED_MS = Date.parse('2026-10-08T10:00:00.000Z')
const IDLE_MS = backlog_budget.DEFAULT_IDLE_MS
const LONG_RUN_MS = IDLE_MS + MINUTE_MS
const ASKED_OFFSET_MS = 2 * MINUTE_MS

function input(active_at_ms: number, idle_budget_ms: number | undefined): BudgetInput {
	return {
		answer: 'exhausted',
		merged: 0,
		running: 0,
		started_at_ms: STARTED_MS,
		active_at_ms,
		now_ms: active_at_ms + ASKED_OFFSET_MS,
		max_issues: undefined,
		idle_budget_ms,
	}
}

function window_at(asked_ms: number): IdleWindow {
	return { since_ms: STARTED_MS, until_ms: STARTED_MS + IDLE_MS, asked_ms }
}

describe('backlog_idle.window_of — when the wait ends', () => {
	it('runs for the idle budget from when the run last had work, as asked now', () => {
		const active = STARTED_MS + MINUTE_MS

		expect(backlog_idle.window_of(input(active, IDLE_MS))).toEqual({
			since_ms: active,
			until_ms: active + IDLE_MS,
			asked_ms: active + ASKED_OFFSET_MS,
		})
	})

	it('is eight hours long by default', () => {
		const window = backlog_idle.window_of(input(STARTED_MS, IDLE_MS))

		expect(IDLE_MS).toBe(backlog_budget.IDLE_WAIT_HOURS * MINUTES_PER_HOUR * MINUTE_MS)
		expect(window?.until_ms).toBe(STARTED_MS + IDLE_MS)
	})

	// joshuafolkken/kit#3687: the run's start no longer cuts the wait short.
	it('is not cut short by how long ago the run started', () => {
		const active = STARTED_MS + LONG_RUN_MS

		expect(backlog_idle.window_of(input(active, IDLE_MS))).toMatchObject({
			since_ms: active,
			until_ms: active + IDLE_MS,
		})
	})

	it('has no window when the watch is off', () => {
		expect(backlog_idle.window_of(input(STARTED_MS, undefined))).toBeUndefined()
	})
})

describe('backlog_idle.text_of / parse — the line the stream carries', () => {
	it('reads back the window it wrote', () => {
		const window = window_at(STARTED_MS + ASKED_OFFSET_MS)

		expect(backlog_idle.parse(backlog_idle.text_of(window))).toEqual(window)
	})

	it('reads a malformed line as no window', () => {
		expect(backlog_idle.parse('idle since never until later asked now')).toBeUndefined()
		expect(
			backlog_idle.parse('idle since 2026-01-01T00:00:00.000Z until 2026-01-01T08:00:00.000Z'),
		).toBeUndefined()
		expect(backlog_idle.parse('backlog drained')).toBeUndefined()
	})
})
