import type { LedgerEntry, StageEntry } from './lane-ledger'
import { lane_paused_spans } from './lane-paused-spans'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// How many turns a lane spends where: the period's lane transcripts' tool calls counted per lane and
// stage, one row per stage with the median over lanes — printed by `josh lane:stats`, so the stage
// whose round trips are worth removing next is a count, not only a duration (joshuafolkken/kit#6209).
//
// **A call's stage is the ledger interval its start falls in**: `implement` from a dispatch to the
// first ship stage after it — to the issue's next dispatch while none has, so a lane still
// implementing counts its calls there — each `stage` entry from its start to its `at`. A lap inside a stage
// (`ci-wait` inside `followup`) takes the call, the shortest interval holding it; a call in none is
// counted `between stages`.
//
// **The lanes are the period's dispatched issues.** One with no transcript call in the period is left
// out of every median and counted on the `no transcript` row, never read as a lane of zero calls.

const BETWEEN = 'between stages'
const NO_TRANSCRIPT = 'no transcript'
const NO_VALUE = '-'
const COLUMNS = ['stage turns', 'calls per lane (median)', 'lanes'] as const
const ROWS = [...lane_stage_stats.STAGES, BETWEEN] as const

interface Interval {
	issue: number
	stage: string
	from_ms: number
	to_ms: number
}

interface IssueStage {
	issue: number
	stage: string
}

// Each measured lane's calls, as the stage of each call.
interface Lanes {
	measured: ReadonlyArray<ReadonlyArray<string>>
	without: number
}

interface IssueCall {
	issue: number | undefined
	at_ms: number
}

function is_issue_stage(entry: LedgerEntry): entry is StageEntry & { issue: number } {
	return lane_stage_stats.is_stage(entry) && entry.issue !== undefined
}

function is_lane_call(call: IssueCall): call is IssueCall & { issue: number } {
	return call.issue !== undefined
}

function stage_intervals(entries: ReadonlyArray<LedgerEntry>): Array<Interval> {
	return entries
		.filter((entry) => is_issue_stage(entry))
		.map((stage) => ({
			issue: stage.issue,
			stage: stage.stage,
			from_ms: lane_stage_stats.started_ms(stage),
			to_ms: Date.parse(stage.at),
		}))
}

function intervals_of(entries: ReadonlyArray<LedgerEntry>): Array<Interval> {
	const implement = lane_stage_stats.implement_spans(entries).map(({ issue, from_ms, to_ms }) => ({
		issue,
		stage: lane_stage_stats.IMPLEMENT,
		from_ms,
		to_ms,
	}))

	return [...implement, ...stage_intervals(entries)]
}

function span_ms(interval: Interval): number {
	return interval.to_ms - interval.from_ms
}

function stage_of(at_ms: number, issue: number, intervals: ReadonlyArray<Interval>): string {
	const holding = intervals.filter(
		(interval) => interval.issue === issue && at_ms >= interval.from_ms && at_ms <= interval.to_ms,
	)

	return holding.toSorted((left, right) => span_ms(left) - span_ms(right))[0]?.stage ?? BETWEEN
}

function issue_stages(
	calls: ReadonlyArray<ToolCall>,
	intervals: ReadonlyArray<Interval>,
): Array<IssueStage> {
	return calls
		.map((call) => ({ issue: lane_paused_spans.issue_of_lane(call.lane), at_ms: call.started_ms }))
		.filter((call) => is_lane_call(call))
		.map(({ issue, at_ms }) => ({ issue, stage: stage_of(at_ms, issue, intervals) }))
}

function lanes_of(entries: ReadonlyArray<LedgerEntry>, calls: ReadonlyArray<ToolCall>): Lanes {
	const stages = issue_stages(calls, intervals_of(entries))
	const dispatches = entries.filter((entry) => lane_stage_stats.is_dispatch(entry))
	const dispatched = new Set(dispatches.map(({ issue }) => issue))
	const measured = [...dispatched]
		.map((issue) => stages.filter((call) => call.issue === issue).map(({ stage }) => stage))
		.filter((lane) => lane.length > 0)

	return { measured, without: dispatched.size - measured.length }
}

function stage_row(stage: string, lanes: Lanes): string {
	const counts = lanes.measured.map((lane) => lane.filter((name) => name === stage).length)
	const median = lane_stats.median(counts)

	return lane_stats.to_row([
		stage,
		median === undefined ? lane_stage_stats.NOT_MEASURED : String(median),
		String(lanes.measured.length),
	])
}

// The period's table: `entries` is the whole ledger and `calls` every lane session's calls, both
// filtered here to `window`.
function table(
	entries: ReadonlyArray<LedgerEntry>,
	calls: ReadonlyArray<ToolCall>,
	window: StatsWindow,
): string {
	const lanes = lanes_of(
		lane_stats.in_window(entries, window),
		lane_transcript_stats.in_period(calls, window),
	)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...ROWS.map((stage) => stage_row(stage, lanes)),
		lane_stats.to_row([NO_TRANSCRIPT, NO_VALUE, String(lanes.without)]),
	].join('\n')
}

const lane_turn_stats = { table }

export { lane_turn_stats }
