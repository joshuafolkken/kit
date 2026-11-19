import { lane_breakdown } from './lane-breakdown'
import { lane_implement_stats, type StagedCall, type SubStage } from './lane-implement-stats'
import type { ImplementLane } from './lane-implement-subagents'
import type { LaneSpan } from './lane-net-time'
import type { PausedSpans } from './lane-paused-spans'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'

// Each implement sub-stage split into the model's turns and the tools' run time (joshuafolkken/kit#8093):
// a stage's `tool` is the union of its calls' runs clipped to their spans, so parallel calls count
// once, and its `model turn` is the rest of the stage's active time. A backgrounded or unanswered
// call's run is all model turn, as in `lane-implement-read.ts`.

const COLUMNS = ['implement turn split', 'lanes', 'model turn (min)', 'tool (min)'] as const

interface StageSplit {
	model_ms: number
	tool_ms: number
}

// The part of the call's run inside its span; `undefined` for a call with no measured run.
function run_of(entry: StagedCall): LaneSpan | undefined {
	const { call } = entry
	if (call.background || call.duration_ms === undefined) return undefined

	return {
		from_ms: Math.max(call.started_ms, entry.from_ms),
		to_ms: call.started_ms + call.duration_ms,
	}
}

function sum(values: ReadonlyArray<number>): number {
	return values.reduce((total, value) => total + value, 0)
}

// The union of the runs, each millisecond counted once.
function union_ms(runs: ReadonlyArray<LaneSpan>): number {
	if (runs.length === 0) return 0
	const segment = {
		from_ms: Math.min(...runs.map((run) => run.from_ms)),
		to_ms: Math.max(...runs.map((run) => run.to_ms)),
	}

	return lane_breakdown.covered_ms(segment, runs)
}

// One stage's split; the tool time never passes the active time a pause shortened.
function split_of(entries: ReadonlyArray<StagedCall>): StageSplit {
	const active = sum(entries.map((entry) => entry.active_ms))
	const tool = Math.min(active, union_ms(entries.flatMap((entry) => run_of(entry) ?? [])))

	return { model_ms: active - tool, tool_ms: tool }
}

function lane_splits(lane: ImplementLane): Map<SubStage, StageSplit> {
	const entries = lane_implement_stats.staged(lane.calls, lane.paused)

	return new Map(
		lane_implement_stats.SUB_STAGES.map((stage) => [
			stage,
			split_of(entries.filter((entry) => entry.stage === stage)),
		]),
	)
}

function stage_row(stage: SubStage, splits: ReadonlyArray<StageSplit>): Array<string> {
	return [
		stage,
		String(splits.length),
		lane_stage_stats.cell(lane_stats.median(splits.map((split) => split.model_ms))),
		lane_stage_stats.cell(lane_stats.median(splits.map((split) => split.tool_ms))),
	]
}

// The period's table: per sub-stage, the medians over the lanes that shipped in `window`.
function table(calls: ReadonlyArray<ToolCall>, window: StatsWindow, paused: PausedSpans): string {
	const lanes = lane_implement_stats
		.implement_lanes(calls, window, paused)
		.map((lane) => lane_splits(lane))
	const rows = lane_implement_stats.SUB_STAGES.map((stage) =>
		stage_row(
			stage,
			lanes.flatMap((splits) => splits.get(stage) ?? []),
		),
	)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...rows.map((row) => lane_stats.to_row(row)),
	].join('\n')
}

const lane_implement_tool_split = { table }

export { lane_implement_tool_split }
