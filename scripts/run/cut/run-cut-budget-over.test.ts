import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_stage_budget } from '#scripts/lane/lane-stage-budget'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_cut_budget_over } from './run-cut-budget-over'

const ISSUE = 6026
const OTHER_ISSUE = 6027
const BASE_MS = Date.parse('2026-11-03T00:00:00.000Z')
const IMPLEMENT_BUDGET_MINUTES = lane_stage_budget.BUDGET_MINUTES.implement
const OVER_MINUTES = 5
const LATE_MINUTES = 40
const NOW_MS = BASE_MS + (LATE_MINUTES + IMPLEMENT_BUDGET_MINUTES + OVER_MINUTES) * MS_PER_MINUTE

function iso(minutes: number): string {
	return new Date(BASE_MS + minutes * MS_PER_MINUTE).toISOString()
}

function dispatch(minutes: number, issue = ISSUE): LedgerEntry {
	return { kind: lane_ledger.KIND.DISPATCH, at: iso(minutes), issue }
}

function plan(minutes: number, issue = ISSUE): RunEvent {
	return {
		pos: minutes,
		at: iso(minutes),
		kind: run_event_stream.EVENT_KIND.PLAN,
		text: `#${String(issue)} plan`,
	}
}

function stub(now_ms: number): void {
	vi.spyOn(lane_ledger, 'target').mockResolvedValue('/ledger.jsonl')
	vi.spyOn(lane_ledger, 'read_entries').mockReturnValue([dispatch(LATE_MINUTES)])
	vi.spyOn(run_event_stream_emit, 'all_events').mockResolvedValue([plan(LATE_MINUTES)])
	vi.spyOn(Date, 'now').mockReturnValue(now_ms)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_cut_budget_over.over_of', () => {
	it('measures the implementation from its first plan since the latest dispatch', () => {
		const entries = [dispatch(0), dispatch(LATE_MINUTES)]
		const events = [plan(1), plan(LATE_MINUTES), plan(LATE_MINUTES + 1)]

		expect(run_cut_budget_over.over_of(entries, events, ISSUE, NOW_MS)).toBe(OVER_MINUTES)
	})

	it('is within the budget before it runs out', () => {
		const within_ms = BASE_MS + (LATE_MINUTES + IMPLEMENT_BUDGET_MINUTES) * MS_PER_MINUTE

		expect(
			run_cut_budget_over.over_of([dispatch(LATE_MINUTES)], [plan(LATE_MINUTES)], ISSUE, within_ms),
		).toBeUndefined()
	})

	it('reads no other issue’s plan, and nothing before a plan', () => {
		const entries = [dispatch(LATE_MINUTES)]

		expect(
			run_cut_budget_over.over_of(entries, [plan(LATE_MINUTES, OTHER_ISSUE)], ISSUE, NOW_MS),
		).toBeUndefined()
	})
})

// joshuafolkken/kit#6544: the split notice's time bar reads the ledger and the run events at now.
describe('run_cut_budget_over.implement_over', () => {
	it('answers the minutes over once the budget runs out', async () => {
		stub(NOW_MS)

		await expect(run_cut_budget_over.implement_over(ISSUE)).resolves.toBe(OVER_MINUTES)
	})

	it('answers nothing within the budget', async () => {
		stub(BASE_MS + LATE_MINUTES * MS_PER_MINUTE)

		await expect(run_cut_budget_over.implement_over(ISSUE)).resolves.toBeUndefined()
	})
})
