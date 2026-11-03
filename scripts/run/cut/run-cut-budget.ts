import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_spill } from '#scripts/issue/issue-spill'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_breakdown_pause } from '#scripts/lane/lane-breakdown-pause'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_stage_budget } from '#scripts/lane/lane-stage-budget'
import { lane_stage_stats } from '#scripts/lane/lane-stage-stats'
import { lane_stop_stats } from '#scripts/lane/lane-stop-stats'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_cut_report } from './run-cut-report'

// Whether a pre-gate cut answers `budget-over` (joshuafolkken/kit#6026): the implementation has run past
// its stage budget (`lane-stage-budget.ts`, the single source) and the Issue already has a green part —
// at least one checked acceptance criterion — to ship while the rest is spilled. Without one there is
// nothing to ship, so the cut goes on as before. Nothing is cut either way: the run ships on this tree.

const BUDGET_OVER_VERDICT = 'budget-over'

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

async function has_green_part(issue: number): Promise<boolean> {
	const body = await git_gh_issue_read.issue_get_body(String(issue))

	return body !== undefined && issue_spill.checked_count(body) > 0
}

// The minutes over where `issue`'s implementation is past its budget with a green part checked, else
// `undefined`. The Issue body is read only once the budget is over.
async function over_minutes(issue: number): Promise<number | undefined> {
	const events = await run_event_stream_emit.all_events()
	const over = over_of(await ledger_entries(), events, issue, Date.now())

	if (over === undefined) return undefined

	return (await has_green_part(issue)) ? over : undefined
}

function report_over(issue: string, over: number): number {
	console.error(
		`The implementation of ${session_cite.issue(issue)} is ${String(over)} min over its stage budget, so nothing was cut. Check off the acceptance criteria this tree meets, move the rest out with \`pnpm josh issue:spill ${issue} --estimate "<files> ファイル / <lines> 行"\`, and go on to \`run:review\` and the ship on this tree without resuming.`,
	)

	return run_cut_report.report(BUDGET_OVER_VERDICT, run_cut_report.SUCCESS_EXIT_CODE)
}

const run_cut_budget = { BUDGET_OVER_VERDICT, over_minutes, over_of, report_over }

export { run_cut_budget }
