import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_stage_budget } from '#scripts/lane/lane-stage-budget'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_cut_budget } from './run-cut-budget'

const ISSUE = 6026
const BASE_MS = Date.parse('2026-11-03T00:00:00.000Z')
const IMPLEMENT_BUDGET_MINUTES = lane_stage_budget.BUDGET_MINUTES.implement
const OVER_MINUTES = 5
const LATE_MINUTES = 40
const NOW_MS = BASE_MS + (LATE_MINUTES + IMPLEMENT_BUDGET_MINUTES + OVER_MINUTES) * MS_PER_MINUTE
const GREEN_BODY = '## 受け入れ条件\n\n- [x] done\n- [ ] left'
const NO_GREEN_BODY = '## 受け入れ条件\n\n- [ ] left'

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

function stub(body: string | undefined, now_ms = NOW_MS): void {
	vi.spyOn(lane_ledger, 'target').mockResolvedValue('/ledger.jsonl')
	vi.spyOn(lane_ledger, 'read_entries').mockReturnValue([dispatch(LATE_MINUTES)])
	vi.spyOn(run_event_stream_emit, 'all_events').mockResolvedValue([plan(LATE_MINUTES)])
	vi.spyOn(git_gh_issue_read, 'issue_get_body').mockResolvedValue(body)
	vi.spyOn(Date, 'now').mockReturnValue(now_ms)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_cut_budget.over_minutes', () => {
	it('answers the minutes over where a criterion is checked', async () => {
		stub(GREEN_BODY)

		expect(await run_cut_budget.over_minutes(ISSUE)).toBe(OVER_MINUTES)
	})

	it('answers nothing where no criterion is checked', async () => {
		stub(NO_GREEN_BODY)

		expect(await run_cut_budget.over_minutes(ISSUE)).toBeUndefined()
	})

	it('answers nothing where the body cannot be read', async () => {
		stub(undefined)

		expect(await run_cut_budget.over_minutes(ISSUE)).toBeUndefined()
	})

	it('reads no body within the budget', async () => {
		stub(GREEN_BODY, BASE_MS + LATE_MINUTES * MS_PER_MINUTE)

		expect(await run_cut_budget.over_minutes(ISSUE)).toBeUndefined()
		expect(git_gh_issue_read.issue_get_body).not.toHaveBeenCalled()
	})
})
