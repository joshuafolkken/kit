import { lane_breakdown } from './lane-breakdown'
import { lane_implement_stats, type StagedCall, type SubStage } from './lane-implement-stats'
import type { ImplementLane } from './lane-implement-subagents'
import type { LaneSpan } from './lane-net-time'
import type { PausedSpan, PausedSpans } from './lane-paused-spans'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'

// Each implement sub-stage split into the model's turns and the tools' run time (joshuafolkken/kit#8093):
// a stage's `tool` is the union of its calls' runs clipped to their spans, so parallel calls count
// once, less `lane:pause` time, and its `model turn` is the rest of the stage's active time. A backgrounded or unanswered
// call's run is all model turn, as in `lane-implement-read.ts`.

const COLUMNS = ['implement turn split', 'lanes', 'model turn (min)', 'tool (min)'] as const

interface StageSplit {
	model_ms: number
	tool_ms: number
}

interface LaneEntries {
	entries: ReadonlyArray<StagedCall>
	paused: ReadonlyArray<PausedSpan>
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

// The stretches where a run and a pause overlap.
function paused_parts(
	runs: ReadonlyArray<LaneSpan>,
	paused: ReadonlyArray<PausedSpan>,
): Array<LaneSpan> {
	return runs.flatMap((run) =>
		paused.map((span) => ({
			from_ms: Math.max(run.from_ms, span.from_ms),
			to_ms: Math.min(run.to_ms, span.to_ms),
		})),
	)
}

// The union of the runs less their paused stretches, each millisecond counted once.
function run_ms(runs: ReadonlyArray<LaneSpan>, paused: ReadonlyArray<PausedSpan>): number {
	if (runs.length === 0) return 0
	const segment = {
		from_ms: Math.min(...runs.map((run) => run.from_ms)),
		to_ms: Math.max(...runs.map((run) => run.to_ms)),
	}
	const covered = lane_breakdown.covered_ms(segment, runs)

	return covered - lane_breakdown.covered_ms(segment, paused_parts(runs, paused))
}

function split_of(
	entries: ReadonlyArray<StagedCall>,
	paused: ReadonlyArray<PausedSpan>,
): StageSplit {
	const active = sum(entries.map((entry) => entry.active_ms))
	const tool = run_ms(
		entries.flatMap((entry) => run_of(entry) ?? []),
		paused,
	)

	return { model_ms: active - tool, tool_ms: tool }
}

// Each lane's split of `stage`, one per lane.
function stage_splits(lanes: ReadonlyArray<LaneEntries>, stage: SubStage): Array<StageSplit> {
	return lanes.map(({ entries, paused }) =>
		split_of(
			entries.filter((entry) => entry.stage === stage),
			paused,
		),
	)
}

function lane_entries(lane: ImplementLane): LaneEntries {
	return { entries: lane_implement_stats.staged(lane.calls, lane.paused), paused: lane.paused }
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
		.map((lane) => lane_entries(lane))
	const rows = lane_implement_stats.SUB_STAGES.map((stage) =>
		stage_row(stage, stage_splits(lanes, stage)),
	)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...rows.map((row) => lane_stats.to_row(row)),
	].join('\n')
}

const lane_implement_tool_split = { table }

export { lane_implement_tool_split }
