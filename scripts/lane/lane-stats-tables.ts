import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { lane_chain_stop_stats } from './lane-chain-stop-stats'
import { lane_check_stats } from './lane-check-stats'
import { lane_ci_path_stats } from './lane-ci-path-stats'
import { lane_claim_stats } from './lane-claim-stats'
import { lane_concurrency_stats } from './lane-concurrency-stats'
import { lane_core_wait_stats } from './lane-core-wait-stats'
import { lane_cut_stats } from './lane-cut-stats'
import { lane_dispatch_wait_stats } from './lane-dispatch-wait-stats'
import { lane_early_push_stats } from './lane-early-push-stats'
import { lane_gap_stats } from './lane-gap-stats'
import { lane_held_stats } from './lane-held-stats'
import { lane_implement_rate } from './lane-implement-rate'
import { lane_implement_read } from './lane-implement-read'
import { lane_implement_stats } from './lane-implement-stats'
import type { lane_ledger } from './lane-ledger'
import { lane_paused_spans } from './lane-paused-spans'
import { lane_process_stats } from './lane-process-stats'
import { lane_round_one_stats } from './lane-round-one-stats'
import { lane_round_two_stats } from './lane-round-two-stats'
import { lane_ship_lap_stats } from './lane-ship-lap-stats'
import { lane_size_stats } from './lane-size-stats'
import { lane_split_stats } from './lane-split-stats'
import { lane_stage_stats } from './lane-stage-stats'
import type { StatsWindow } from './lane-stats'
import { lane_stop_check_stats } from './lane-stop-check-stats'
import { lane_stop_stats } from './lane-stop-stats'
import { lane_test_related_stats } from './lane-test-related-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'
import { lane_turn_stats } from './lane-turn-stats'

// The tables `josh lane:stats` prints under the period's row — the single source `josh lane:value
// cell` reads one cell of (joshuafolkken/kit#5144), so a measurement never copies an aggregation.

interface PeriodRecords {
	entries: ReturnType<typeof lane_ledger.read_entries>
	events: ReadonlyArray<RunEvent>
	calls: ReadonlyArray<ToolCall>
}

// The tables read from the lane transcripts, under the followup critical path table.
function call_tables(
	entries: PeriodRecords['entries'],
	calls: ReadonlyArray<ToolCall>,
	window: StatsWindow,
): Array<string> {
	const paused = lane_paused_spans.by_lane(entries)

	return [
		lane_implement_stats.table(calls, window, paused),
		lane_implement_read.table(calls, window, paused),
		lane_turn_stats.table(entries, calls, window),
	]
}

// The tables of where a lane stopped and waited — `josh ship`'s stops, `run:chain`'s, and the gaps and
// cuts between a lane's runs.
function stop_tables(
	entries: PeriodRecords['entries'],
	events: ReadonlyArray<RunEvent>,
	window: StatsWindow,
): Array<string> {
	return [
		lane_stop_stats.table(entries, window, events),
		lane_stop_check_stats.check_table(entries, window, events),
		lane_stop_check_stats.longest_table(entries, window, events),
		lane_chain_stop_stats.table(entries, window),
		lane_gap_stats.table(entries, window, events),
		lane_cut_stats.table(entries, window, events),
	]
}

// The tables under the period's row, in the order `lane:stats` prints them.
function tables_of({ entries, events, calls }: PeriodRecords, window: StatsWindow): Array<string> {
	return [
		lane_stage_stats.table(entries, window),
		lane_ship_lap_stats.table(entries, window),
		lane_ci_path_stats.table(entries, window),
		...call_tables(entries, calls, window),
		...stop_tables(entries, events, window),
		lane_round_one_stats.table(entries, window),
		lane_round_two_stats.table(entries, window),
		lane_early_push_stats.table(entries, window),
		lane_split_stats.table(entries, window),
		lane_size_stats.table(entries, window),
		lane_implement_rate.table(entries, window),
		lane_held_stats.table(entries, window),
		lane_dispatch_wait_stats.table(entries, window, events),
		lane_core_wait_stats.table(entries, window),
		lane_process_stats.table(entries, window),
		lane_check_stats.table(entries, window),
		lane_claim_stats.table(entries, window),
		lane_test_related_stats.table(entries, window),
		lane_test_related_stats.trigger_table(entries, window),
		lane_transcript_stats.table(calls, window),
		lane_concurrency_stats.table(entries, calls, window),
	]
}

const lane_stats_tables = { tables_of }

export type { PeriodRecords }
export { lane_stats_tables }
