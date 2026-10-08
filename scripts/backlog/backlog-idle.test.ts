import { describe, expect, it } from 'vitest'
import { backlog_budget, type BudgetInput } from './backlog-budget'
import { backlog_idle, type IdleWindow } from './backlog-idle'

// joshuafolkken/kit#3430: the idle watch's window is computed and written in one place, so the budget
// that measures it, the offer that records it and the board that reads it never disagree.

const MINUTE_MS = backlog_budget.MS_PER_MINUTE
const STARTED_MS = Date.parse('2026-10-08T10:00:00.000Z')
const IDLE_MS = backlog_budget.DEFAULT_IDLE_MS
const WHOLE_RUN_MS = backlog_budget.WHOLE_RUN_BUDGET_MS
const POLL_MS = backlog_budget.IDLE_POLL_MINUTES * MINUTE_MS
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
	return { since_ms: STARTED_MS, until_ms: STARTED_MS + IDLE_MS, bound: 'idle', asked_ms }
}

describe('backlog_idle.window_of — when the wait on an empty backlog ends', () => {
	it('ends at the idle budget when that comes first, as asked now', () => {
		const active = STARTED_MS + MINUTE_MS

		expect(backlog_idle.window_of(input(active, IDLE_MS))).toEqual({
			since_ms: active,
			until_ms: active + IDLE_MS,
			bound: 'idle',
			asked_ms: active + ASKED_OFFSET_MS,
		})
	})

	it('ends at the whole-run bound when that comes first', () => {
		const active = STARTED_MS + WHOLE_RUN_MS - MINUTE_MS

		expect(backlog_idle.window_of(input(active, IDLE_MS))).toMatchObject({
			since_ms: active,
			until_ms: STARTED_MS + WHOLE_RUN_MS,
			bound: 'whole-run',
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
		expect(backlog_idle.parse('idle since never until later (idle) asked now')).toBeUndefined()
		expect(
			backlog_idle.parse(
				'idle since 2026-01-01T00:00:00.000Z until 2026-01-01T00:30:00.000Z (idle)',
			),
		).toBeUndefined()
		expect(backlog_idle.parse('backlog drained')).toBeUndefined()
	})
})

describe('backlog_idle.next_check_ms — the watching poll cadence', () => {
	it('counts the next poll from the recorded ask, not from the start of the wait', () => {
		const asked = STARTED_MS + ASKED_OFFSET_MS + POLL_MS

		expect(backlog_idle.next_check_ms(window_at(asked))).toBe(asked + POLL_MS)
	})

	it('never names a check past the end of the wait', () => {
		const window = window_at(STARTED_MS + IDLE_MS - MINUTE_MS)

		expect(backlog_idle.next_check_ms(window)).toBe(window.until_ms)
	})
})
