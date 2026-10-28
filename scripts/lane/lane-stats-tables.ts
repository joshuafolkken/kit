import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { lane_check_stats } from './lane-check-stats'
import { lane_ci_path_stats } from './lane-ci-path-stats'
import { lane_claim_stats } from './lane-claim-stats'
import { lane_core_wait_stats } from './lane-core-wait-stats'
import { lane_gap_stats } from './lane-gap-stats'
import { lane_held_stats } from './lane-held-stats'
import { lane_implement_stats } from './lane-implement-stats'
import type { lane_ledger } from './lane-ledger'
import { lane_paused_spans } from './lane-paused-spans'
import { lane_process_stats } from './lane-process-stats'
import { lane_round_one_stats } from './lane-round-one-stats'
import { lane_round_two_stats } from './lane-round-two-stats'
import { lane_ship_lap_stats } from './lane-ship-lap-stats'
import { lane_split_stats } from './lane-split-stats'
import { lane_stage_stats } from './lane-stage-stats'
import type { StatsWindow } from './lane-stats'
import { lane_stop_stats } from './lane-stop-stats'
import { lane_test_related_stats } from './lane-test-related-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// The tables `josh lane:stats` prints under the period's row — the single source `josh lane:value
// cell` reads one cell of (joshuafolkken/kit#5144), so a measurement never copies an aggregation.

interface PeriodRecords {
	entries: ReturnType<typeof lane_ledger.read_entries>
	events: ReadonlyArray<RunEvent>
	calls: ReadonlyArray<ToolCall>
}

// The tables under the period's row, in the order `lane:stats` prints them.
function tables_of({ entries, events, calls }: PeriodRecords, window: StatsWindow): Array<string> {
	return [
		lane_stage_stats.table(entries, window),
		lane_ship_lap_stats.table(entries, window),
		lane_ci_path_stats.table(entries, window),
		lane_implement_stats.table(calls, window, lane_paused_spans.by_lane(entries)),
		lane_stop_stats.table(entries, window, events),
		lane_gap_stats.table(entries, window, events),
		lane_round_one_stats.table(entries, window),
		lane_round_two_stats.table(entries, window),
		lane_split_stats.table(entries, window),
		lane_held_stats.table(entries, window),
		lane_core_wait_stats.table(entries, window),
		lane_process_stats.table(entries, window),
		lane_check_stats.table(entries, window),
		lane_claim_stats.table(entries, window),
		lane_test_related_stats.table(entries, window),
		lane_test_related_stats.trigger_table(entries, window),
		lane_transcript_stats.table(calls, window),
	]
}

const lane_stats_tables = { tables_of }

export type { PeriodRecords }
export { lane_stats_tables }
