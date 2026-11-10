import { lane_breakdown_pause } from '#scripts/lane/lane-breakdown-pause'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_stage_budget } from '#scripts/lane/lane-stage-budget'
import { lane_stage_stats } from '#scripts/lane/lane-stage-stats'
import { lane_stop_stats } from '#scripts/lane/lane-stop-stats'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// How far the implementation has run past its stage budget (`lane-stage-budget.ts`, the single source),
// and the one way out of it. `run:cut`'s `budget-over` (`run-cut-budget.ts`) and the split notice a
// scoped check prints (`split-early-notice.ts`, joshuafolkken/kit#6544) both read it. It reads no Issue
// body, so the scoped checks reach no Issue-body module through it.

function dispatched_ms(entries: ReadonlyArray<LedgerEntry>, issue: number): number {
	const dispatch = entries
		.filter((entry) => lane_stage_stats.is_dispatch(entry))
		.findLast((entry) => entry.issue === issue)

	return dispatch === undefined ? 0 : Date.parse(dispatch.at)
}

// The implementation's start: `issue`'s first `plan` / `lane-phase implement` marker since its latest
// dispatch — where `lane:breakdown` opens the stage, a mark no resume moves.
function implement_start_ms(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): number | undefined {
	const from_ms = dispatched_ms(entries, issue)
	const start = events.find(
		(event) =>
			lane_stop_stats.issue_of(event) === issue &&
			lane_breakdown_pause.is_planning(event) &&
			Date.parse(event.at) >= from_ms,
	)

	return start === undefined ? undefined : Date.parse(start.at)
}

// The whole minutes the implementation runs past its budget at `now_ms`, `undefined` within it or before
// it started.
function over_of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
	now_ms: number,
): number | undefined {
	const start_ms = implement_start_ms(entries, events, issue)

	if (start_ms === undefined) return undefined

	return lane_stage_budget.over_minutes('implement', now_ms - start_ms)
}

async function ledger_entries(): Promise<ReadonlyArray<LedgerEntry>> {
	const target = await lane_ledger.target()

	return target === undefined ? [] : lane_ledger.read_entries(target)
}

// The minutes `issue`'s implementation is past its budget now, `undefined` within it or before it
// started.
async function implement_over(issue: number): Promise<number | undefined> {
	const events = await run_event_stream_emit.all_events()

	return over_of(await ledger_entries(), events, issue, Date.now())
}

// `issue:spill` files the rest as a split child (`issue:file --route split`, recording `split-filed`)
// and the run ships the tree it has. The split route does not excuse the implement budget, so a rest
// projected past it needs `--reason` (joshuafolkken/kit#7005).
function spill_steps(issue: string): string {
	return `Check off the acceptance criteria this tree meets, move the rest out with \`pnpm josh issue:spill ${issue} --estimate "<files> ファイル / <lines> 行"\` (add \`--reason "<理由>"\` when it refuses the rest over the implement budget), and go on to \`run:review\` and the ship on this tree without resuming.`
}

const run_cut_budget_over = { implement_over, over_of, spill_steps }

export { run_cut_budget_over }
