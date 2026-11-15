import { lane_ledger, type CoreWaitEntry, type LedgerEntry } from './lane-ledger'
import { lane_paused_spans } from './lane-paused-spans'
import type { ToolCall } from './lane-transcript-calls'

// The core-budget wait inside one `lint:related` / `test:related` call (joshuafolkken/kit#7550): the
// `core_wait` records its own lane wrote for the same command while the call ran, summed — one call
// can admit more than one claim. `undefined` when no record ties to the call: no record is not a
// zero wait, since an admission with no decision and no wait writes nothing.

type LaneWait = CoreWaitEntry & { issue: number }

function is_lane_wait(entry: LedgerEntry): entry is LaneWait {
	return (
		(entry.kind === lane_ledger.KIND.CORE_WAIT || entry.kind === lane_ledger.KIND.CORE_ADMISSION) &&
		entry.issue !== undefined
	)
}

function waits_of(entries: ReadonlyArray<LedgerEntry>): Array<LaneWait> {
	return entries.filter((entry) => is_lane_wait(entry))
}

function is_inside(at: string, call: ToolCall, ended_ms: number): boolean {
	const at_ms = Date.parse(at)

	return at_ms >= call.started_ms && at_ms <= ended_ms
}

function wait_ms(waits: ReadonlyArray<LaneWait>, name: string, call: ToolCall): number | undefined {
	const issue = lane_paused_spans.issue_of_lane(call.lane)
	const ended_ms = call.started_ms + (call.duration_ms ?? 0)
	const tied = waits.filter(
		(wait) => wait.issue === issue && wait.command === name && is_inside(wait.at, call, ended_ms),
	)

	return tied.length === 0 ? undefined : tied.reduce((sum, wait) => sum + wait.waited_ms, 0)
}

const lane_concurrency_wait = { waits_of, wait_ms }

export type { LaneWait }
export { lane_concurrency_wait }
