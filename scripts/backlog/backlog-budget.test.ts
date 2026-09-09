import { describe, expect, it } from 'vitest'
import { backlog_budget, type BacklogAnswer, type BudgetInput } from './backlog-budget'

const NOW_MS = Date.parse('2026-09-09T12:00:00Z')
const MINUTE_MS = backlog_budget.MS_PER_MINUTE
const IDLE_BUDGET_MINUTES = 30
const IDLE_HALFWAY_MINUTES = 15
const RUN_AGE_MINUTES = 60
const IDLE_BUDGET_MS = IDLE_BUDGET_MINUTES * MINUTE_MS
const HALF_IDLE_MS = IDLE_HALFWAY_MINUTES * MINUTE_MS
const RUN_AGE_MS = RUN_AGE_MINUTES * MINUTE_MS
const MAX_ISSUES = 5
const MERGED_UNDER_MAX = 2
const MANY_MERGED = 99

function input_of(overrides: Partial<BudgetInput> & { answer: BacklogAnswer }): BudgetInput {
	return {
		merged: 0,
		running: 0,
		started_at_ms: NOW_MS - RUN_AGE_MS,
		active_at_ms: NOW_MS,
		now_ms: NOW_MS,
		max_issues: undefined,
		idle_budget_ms: undefined,
		...overrides,
	}
}

describe('backlog_budget.decide — the defaults leave the run exactly as it was', () => {
	it('finishes on an empty backlog when no idle watch was asked for', () => {
		const decision = backlog_budget.decide(input_of({ answer: 'exhausted' }))

		expect(decision.verdict).toBe(backlog_budget.STOP_VERDICT)
		expect(decision.reason).toBe(backlog_budget.NO_IDLE_WATCH_REASON)
	})

	it('starts every candidate when no maximum was given', () => {
		const input = input_of({ answer: 'candidates', merged: MANY_MERGED })
		const decision = backlog_budget.decide(input)

		expect(decision.verdict).toBe(backlog_budget.RUN_VERDICT)
		expect(decision.reason).toBe(backlog_budget.run_reason(input))
	})

	it('keeps polling while something opted in is blocked or running', () => {
		const decision = backlog_budget.decide(input_of({ answer: 'blocked' }))

		expect(decision.verdict).toBe(backlog_budget.WATCH_VERDICT)
		expect(decision.reason).toBe(backlog_budget.BLOCKED_REASON)
	})
})

describe('backlog_budget.decide — the idle watch', () => {
	it('watches an empty backlog while the budget has time left', () => {
		const decision = backlog_budget.decide(
			input_of({
				answer: 'exhausted',
				idle_budget_ms: IDLE_BUDGET_MS,
				active_at_ms: NOW_MS - HALF_IDLE_MS,
			}),
		)

		expect(decision.verdict).toBe(backlog_budget.WATCH_VERDICT)
		expect(decision.reason).toBe(backlog_budget.idle_watch_reason(HALF_IDLE_MS))
	})

	it('finishes once the idle budget has run out', () => {
		const decision = backlog_budget.decide(
			input_of({
				answer: 'exhausted',
				idle_budget_ms: IDLE_BUDGET_MS,
				active_at_ms: NOW_MS - IDLE_BUDGET_MS,
			}),
		)

		expect(decision.verdict).toBe(backlog_budget.STOP_VERDICT)
		expect(decision.reason).toBe(backlog_budget.idle_expired_reason(IDLE_BUDGET_MS))
	})
})

describe('backlog_budget.decide — a candidate that appears during the watch', () => {
	it('picks it up rather than going on watching', () => {
		const decision = backlog_budget.decide(
			input_of({
				answer: 'candidates',
				idle_budget_ms: IDLE_BUDGET_MS,
				active_at_ms: NOW_MS - HALF_IDLE_MS,
			}),
		)

		expect(decision.verdict).toBe(backlog_budget.RUN_VERDICT)
	})

	it('restarts the watch from the moment the candidate was picked up', () => {
		const restarted = backlog_budget.decide(
			input_of({ answer: 'exhausted', idle_budget_ms: IDLE_BUDGET_MS, active_at_ms: NOW_MS }),
		)

		expect(restarted.verdict).toBe(backlog_budget.WATCH_VERDICT)
		expect(restarted.reason).toBe(backlog_budget.idle_watch_reason(IDLE_BUDGET_MS))
	})
})

describe('backlog_budget.decide — the maximum issue count', () => {
	it('allows the issues still under the maximum', () => {
		const input = input_of({
			answer: 'candidates',
			max_issues: MAX_ISSUES,
			merged: MERGED_UNDER_MAX,
		})
		const decision = backlog_budget.decide(input)

		expect(decision.verdict).toBe(backlog_budget.RUN_VERDICT)
		expect(decision.reason).toBe(backlog_budget.run_reason(input))
	})

	it('counts the children still running, not only the merged ones', () => {
		const input = input_of({
			answer: 'candidates',
			max_issues: MAX_ISSUES,
			merged: 0,
			running: MERGED_UNDER_MAX,
		})

		expect(backlog_budget.taken_by(input)).toBe(MERGED_UNDER_MAX)
		expect(backlog_budget.decide(input).reason).toBe(backlog_budget.run_reason(input))
	})
})

describe('backlog_budget.decide — reaching the maximum', () => {
	it('drains the running children rather than abandoning them', () => {
		const running = MAX_ISSUES - MERGED_UNDER_MAX
		const decision = backlog_budget.decide(
			input_of({
				answer: 'candidates',
				max_issues: MAX_ISSUES,
				merged: MERGED_UNDER_MAX,
				running,
			}),
		)

		expect(decision.verdict).toBe(backlog_budget.WATCH_VERDICT)
		expect(decision.reason).toBe(backlog_budget.max_draining_reason(running, MAX_ISSUES))
	})

	it('finishes with the reason named once the maximum is reached', () => {
		const decision = backlog_budget.decide(
			input_of({ answer: 'candidates', max_issues: MAX_ISSUES, merged: MAX_ISSUES }),
		)

		expect(decision.verdict).toBe(backlog_budget.STOP_VERDICT)
		expect(decision.reason).toBe(backlog_budget.max_reached_reason(MAX_ISSUES, MAX_ISSUES))
	})

	it('outranks an idle watch that still has time left', () => {
		const decision = backlog_budget.decide(
			input_of({
				answer: 'exhausted',
				max_issues: MAX_ISSUES,
				merged: MAX_ISSUES,
				idle_budget_ms: IDLE_BUDGET_MS,
			}),
		)

		expect(decision.reason).toBe(backlog_budget.max_reached_reason(MAX_ISSUES, MAX_ISSUES))
	})
})

describe('backlog_budget.decide — the bounds that outrank both budgets', () => {
	it('stops at the whole-run bound even mid-watch', () => {
		const decision = backlog_budget.decide(
			input_of({
				answer: 'candidates',
				started_at_ms: NOW_MS - backlog_budget.WHOLE_RUN_BUDGET_MS,
				idle_budget_ms: IDLE_BUDGET_MS,
			}),
		)

		expect(decision.verdict).toBe(backlog_budget.STOP_VERDICT)
		expect(decision.reason).toBe(backlog_budget.WHOLE_RUN_REASON)
	})

	it('keeps running just under the whole-run bound', () => {
		const decision = backlog_budget.decide(
			input_of({
				answer: 'candidates',
				started_at_ms: NOW_MS - backlog_budget.WHOLE_RUN_BUDGET_MS + MINUTE_MS,
			}),
		)

		expect(decision.verdict).toBe(backlog_budget.RUN_VERDICT)
	})
})

describe('backlog_budget.decide — the answers no budget can rescue', () => {
	it('reports a parked backlog rather than watching it', () => {
		const decision = backlog_budget.decide(
			input_of({ answer: 'parked', idle_budget_ms: IDLE_BUDGET_MS }),
		)

		expect(decision.verdict).toBe(backlog_budget.STOP_VERDICT)
		expect(decision.reason).toBe(backlog_budget.PARKED_REASON)
	})

	it('reports an unreadable listing rather than reading it as an empty backlog', () => {
		const decision = backlog_budget.decide(
			input_of({ answer: 'unreadable', idle_budget_ms: IDLE_BUDGET_MS }),
		)

		expect(decision.verdict).toBe(backlog_budget.STOP_VERDICT)
		expect(decision.reason).toBe(backlog_budget.UNREADABLE_REASON)
	})

	it('says the listing broke even when the maximum was reached in the same ask', () => {
		const decision = backlog_budget.decide(
			input_of({ answer: 'unreadable', max_issues: MAX_ISSUES, merged: MAX_ISSUES }),
		)

		expect(decision.reason).toBe(backlog_budget.UNREADABLE_REASON)
	})

	it('says the backlog is parked even when the whole-run bound has also passed', () => {
		const decision = backlog_budget.decide(
			input_of({ answer: 'parked', started_at_ms: NOW_MS - backlog_budget.WHOLE_RUN_BUDGET_MS }),
		)

		expect(decision.reason).toBe(backlog_budget.PARKED_REASON)
	})
})
