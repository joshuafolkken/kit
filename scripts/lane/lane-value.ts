import { metrics_totals } from '#scripts/gate/metrics-totals'
import { since_green } from '#scripts/gate/since-green'
import { MS_PER_MINUTE, MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_ship_pre_detach } from '#scripts/run/ship/run-ship-pre-detach'
import { lane_ledger, type CoreWaitEntry, type LedgerEntry } from './lane-ledger'
import { lane_stats, type StatsWindow } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// `josh lane:value <metric> --since <instant>` — one lane measurement as one number, so a follow-up
// measurement Issue can declare it (its measurement declaration line) and `backlog:drive` closes it without a lane
// (joshuafolkken/kit#4630). Each metric is one an Issue measured by hand from the lane transcripts or
// the ledger; `lane:stats` prints the tables they were read from.
//
// **Per lane is per lane, not per session** — every lane runs at least a child and a ship-reviewer
// session, so the divisor is the lanes whose sessions made a tool call in the period. A metric with no
// sample answers `undefined`, never a zero that would pass.

const LINT_RELATED = 'lint:related'
const SHIP = 'ship'
const EDIT_TOOL = 'Edit'
// Both pre-detach forms: a `--since` window from before joshuafolkken/kit#4716 holds the bare form's.
const METRICS_STOPS: ReadonlyArray<string> = [
	metrics_totals.METRICS_RERECORD_COMMAND,
	metrics_totals.METRICS_TOTALS_COMMAND,
].map((list) => run_ship_pre_detach.failure_prefix(list))

interface LaneRecords {
	entries: ReadonlyArray<LedgerEntry>
	calls: ReadonlyArray<ToolCall>
}

type Metric = (records: LaneRecords) => number | undefined

function seconds_of(ms: number | undefined): number | undefined {
	return ms === undefined ? undefined : ms / MS_PER_SECOND
}

// `count` spread over the period's lanes, or `undefined` when no lane ran.
function per_lane(count: number, calls: ReadonlyArray<ToolCall>): number | undefined {
	const lanes = new Set(calls.map((call) => call.lane)).size

	return lanes === 0 ? undefined : count / lanes
}

// #4599: the median time of a `lint:related` that found nothing moved since its last green run.
function lint_unmoved({ calls }: LaneRecords): number | undefined {
	const unmoved = lane_transcript_stats
		.solo_calls(calls, LINT_RELATED)
		.filter((call) => call.output.includes(since_green.UNMOVED_REASON))

	return seconds_of(lane_stats.median(lane_transcript_stats.durations(unmoved)))
}

// #4600: the `ship` calls whose pre-detach check the metrics totals stopped, per lane.
function metrics_stops({ calls }: LaneRecords): number | undefined {
	const stops = calls.filter(
		(call) =>
			lane_transcript_stats.verification_commands(call.command).includes(SHIP) &&
			METRICS_STOPS.some((stop) => call.output.includes(stop)),
	)

	return per_lane(stops.length, calls)
}

// A lane's `lint:related` wait — one outside a lane (the main checkout's) has no `issue` and no lane
// session to be divided among.
function is_lint_wait(entry: LedgerEntry): entry is CoreWaitEntry {
	return (
		entry.kind === lane_ledger.KIND.CORE_WAIT &&
		entry.command === LINT_RELATED &&
		entry.issue !== undefined
	)
}

// #4601: the minutes `lint:related` waited for the core budget, per lane.
function lint_core_wait({ entries, calls }: LaneRecords): number | undefined {
	const waited = entries.filter((entry) => is_lint_wait(entry))
	const total_ms = waited.reduce((sum, wait) => sum + wait.waited_ms, 0)

	return per_lane(total_ms / MS_PER_MINUTE, calls)
}

// #4602: the median time of one `Edit` call, hooks included.
function edit({ calls }: LaneRecords): number | undefined {
	const edits = calls.filter((call) => call.tool === EDIT_TOOL)

	return seconds_of(lane_stats.median(lane_transcript_stats.durations(edits)))
}

const METRICS: Readonly<Record<string, Metric>> = {
	'lint-unmoved': lint_unmoved,
	'metrics-stops': metrics_stops,
	'lint-core-wait': lint_core_wait,
	edit,
}

const NAMES: ReadonlyArray<string> = Object.keys(METRICS)

function is_metric(name: string): boolean {
	return Object.hasOwn(METRICS, name)
}

// The value of `name` over `window`; `records` are the whole ledger and every lane call, cut here.
function value(name: string, records: LaneRecords, window: StatsWindow): number | undefined {
	const metric = is_metric(name) ? METRICS[name] : undefined
	const period = {
		entries: lane_stats.in_window(records.entries, window),
		calls: lane_transcript_stats.in_period(records.calls, window),
	}

	return metric === undefined ? undefined : metric(period)
}

const lane_value = { NAMES, is_metric, value }

export type { LaneRecords }
export { lane_value }
