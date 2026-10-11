import { describe, expect, it } from 'vitest'
import { backlog_budget, type BacklogAnswer, type BudgetInput } from './backlog-budget'

// joshuafolkken/kit#3687: every answer that offers nothing opens the same wait, the wait is the only
// time bound a run has, and only a bound a person typed ends a run ahead of it.

const NOW_MS = Date.parse('2026-10-12T03:33:00Z')
const MINUTE_MS = backlog_budget.MS_PER_MINUTE
const MINUTES_PER_HOUR = 60
const IDLE_MS = backlog_budget.DEFAULT_IDLE_MS
const HALF_IDLE_MS = IDLE_MS / 2
const LONG_RUN_MS = IDLE_MS * 2
const MAX_ISSUES = 3
const RUNNING = 2
const IDLE_ANSWERS = ['exhausted', 'parked', 'unreadable'] as const

function input_of(overrides: Partial<BudgetInput> & { answer: BacklogAnswer }): BudgetInput {
	return {
		merged: 0,
		running: 0,
		started_at_ms: NOW_MS - LONG_RUN_MS,
		active_at_ms: NOW_MS,
		now_ms: NOW_MS,
		max_issues: undefined,
		idle_budget_ms: IDLE_MS,
		...overrides,
	}
}

describe('backlog_budget — the one figure the wait is built from', () => {
	it('waits eight hours by default', () => {
		expect(backlog_budget.DEFAULT_IDLE_MINUTES).toBe(
			backlog_budget.IDLE_WAIT_HOURS * MINUTES_PER_HOUR,
		)
		expect(IDLE_MS).toBe(backlog_budget.DEFAULT_IDLE_MINUTES * MINUTE_MS)
	})
})

describe('backlog_budget.decide — every answer that offers nothing is waited on', () => {
	it.each(IDLE_ANSWERS)('watches on %s while the wait has time left', (answer) => {
		const decision = backlog_budget.decide(
			input_of({ answer, active_at_ms: NOW_MS - HALF_IDLE_MS }),
		)

		expect(decision.verdict).toBe(backlog_budget.WATCH_VERDICT)
		expect(decision.reason).toBe(backlog_budget.idle_watch_reason(answer, HALF_IDLE_MS))
	})

	it.each(IDLE_ANSWERS)('finishes on %s once it stayed so for the whole wait', (answer) => {
		const decision = backlog_budget.decide(input_of({ answer, active_at_ms: NOW_MS - IDLE_MS }))

		expect(decision.verdict).toBe(backlog_budget.STOP_VERDICT)
		expect(decision.reason).toBe(backlog_budget.idle_expired_reason(answer, IDLE_MS))
	})

	it('says which of the three the run is waiting on', () => {
		const reasons = IDLE_ANSWERS.map((answer) => backlog_budget.idle_watch_reason(answer, IDLE_MS))

		expect(new Set(reasons).size).toBe(IDLE_ANSWERS.length)
		expect(reasons[1]).toContain(String(backlog_budget.WAITING_ON.parked))
	})

	it('keeps the working tree while children still run under a parked watch', () => {
		const decision = backlog_budget.decide(input_of({ answer: 'parked', running: RUNNING }))

		expect(decision.reason).toBe(backlog_budget.running_watch_reason('parked', RUNNING, IDLE_MS))
	})
})

describe('backlog_budget.decide — a run is never ended by its age', () => {
	it('starts a candidate offered long after the run began', () => {
		const decision = backlog_budget.decide(input_of({ answer: 'candidates' }))

		expect(decision.verdict).toBe(backlog_budget.RUN_VERDICT)
	})

	it('counts the wait from when the run last had work, not from its start', () => {
		const decision = backlog_budget.decide(input_of({ answer: 'exhausted' }))

		expect(decision.verdict).toBe(backlog_budget.WATCH_VERDICT)
		expect(decision.reason).toBe(backlog_budget.idle_watch_reason('exhausted', IDLE_MS))
	})

	it('keeps polling a blocked backlog however old the run is', () => {
		expect(backlog_budget.decide(input_of({ answer: 'blocked' })).verdict).toBe(
			backlog_budget.WATCH_VERDICT,
		)
	})
})

describe('backlog_budget.decide — the bounds a person typed still end the run', () => {
	it.each(IDLE_ANSWERS)('stops on %s at once under `--idle 0`', (answer) => {
		const decision = backlog_budget.decide(input_of({ answer, idle_budget_ms: undefined }))

		expect(decision.verdict).toBe(backlog_budget.STOP_VERDICT)
		expect(decision.reason).toBe(backlog_budget.no_idle_watch_reason(answer))
	})

	it.each(IDLE_ANSWERS)('stops on %s once the maximum is reached', (answer) => {
		const decision = backlog_budget.decide(
			input_of({ answer, max_issues: MAX_ISSUES, merged: MAX_ISSUES }),
		)

		expect(decision.verdict).toBe(backlog_budget.STOP_VERDICT)
		expect(decision.reason).toBe(backlog_budget.max_reached_reason(MAX_ISSUES, MAX_ISSUES))
	})
})

describe('backlog_budget.is_finish — the run finishing, as against stopping on a person', () => {
	it('is a finish on an empty backlog', () => {
		expect(backlog_budget.is_finish(input_of({ answer: 'exhausted' }))).toBe(true)
	})

	it.each(['parked', 'unreadable', 'blocked'] as const)('is no finish on %s', (answer) => {
		expect(backlog_budget.is_finish(input_of({ answer }))).toBe(false)
	})

	it('is not one at the maximum', () => {
		const at_max = input_of({ answer: 'exhausted', max_issues: MAX_ISSUES, merged: MAX_ISSUES })

		expect(backlog_budget.is_finish(at_max)).toBe(false)
	})
})

describe('backlog_budget.is_idle_watch — the inputs that carry a wait window', () => {
	it.each(IDLE_ANSWERS)('is one on %s under the maximum', (answer) => {
		expect(backlog_budget.is_idle_watch(input_of({ answer }))).toBe(true)
	})

	it.each(['candidates', 'blocked', 'untriaged'] as const)('is not one on %s', (answer) => {
		expect(backlog_budget.is_idle_watch(input_of({ answer }))).toBe(false)
	})

	it('is not one at the maximum, where the watch only drains', () => {
		const at_max = input_of({ answer: 'parked', max_issues: MAX_ISSUES, merged: MAX_ISSUES })

		expect(backlog_budget.is_idle_watch(at_max)).toBe(false)
	})
})
