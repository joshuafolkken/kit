import { lane_ledger, type CoreWaitEntry, type LedgerEntry } from './lane-ledger'
import { lane_paused_spans } from './lane-paused-spans'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

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

function is_inside(wait: LaneWait, call: ToolCall): boolean {
	const at_ms = Date.parse(wait.at)

	return at_ms >= call.started_ms && at_ms <= call.started_ms + (call.duration_ms ?? 0)
}

// Overlapping same-lane calls of one command (a background run beside a foreground one) would each
// read the other's records, so a record goes to one call: the latest that started by the time its
// wait began, else the earliest it falls inside.
function owner_of(wait: LaneWait, rivals: ReadonlyArray<ToolCall>): ToolCall | undefined {
	const holding = rivals
		.filter((rival) => is_inside(wait, rival))
		.toSorted((left, right) => left.started_ms - right.started_ms)
	const wait_started_ms = Date.parse(wait.at) - wait.waited_ms

	return holding.findLast((rival) => rival.started_ms <= wait_started_ms) ?? holding[0]
}

function wait_ms(
	waits: ReadonlyArray<LaneWait>,
	name: string,
	call: ToolCall,
	calls: ReadonlyArray<ToolCall>,
): number | undefined {
	const issue = lane_paused_spans.issue_of_lane(call.lane)
	const rivals = calls.filter(
		(rival) =>
			rival.lane === call.lane &&
			lane_transcript_stats.verification_commands(rival.command).includes(name),
	)
	const tied = waits.filter(
		(wait) => wait.issue === issue && wait.command === name && owner_of(wait, rivals) === call,
	)

	return tied.length === 0 ? undefined : tied.reduce((sum, wait) => sum + wait.waited_ms, 0)
}

const lane_concurrency_wait = { waits_of, wait_ms }

export type { LaneWait }
export { lane_concurrency_wait }
