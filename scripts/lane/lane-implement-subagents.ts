import { lane_paused_spans, type PausedSpan } from './lane-paused-spans'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'

// The implement's subagent time by the agent dispatched (joshuafolkken/kit#5297): one row per agent
// type under `lane:stats`'s implement sub-stages, over the lanes that dispatched it. **A row times the
// call's own duration**, less the time its lane stood paused inside it — the sub-stages above already
// put the same call's span to `plan`, `read` or `review-fix`, so the rows break those down rather than
// add to them. **A backgrounded call is counted, never timed**: its result line is the background
// notice (`lane-transcript-calls.ts`), so it adds to the row's `backgrounded` count alone — a lane
// whose calls of a type were all untimed is not among the lanes the median and max are taken over.
// **The first cell is the type alone**, so a `lane:value cell --row "subagent: <type>"` address holds
// from one period to the next.

// One lane's implement calls and the spans it stood paused (`lane-implement-stats.ts`).
interface ImplementLane {
	calls: ReadonlyArray<ToolCall>
	paused: ReadonlyArray<PausedSpan>
}

interface TypeTotal {
	ms: number
	timed: number
	untimed: number
}

const NO_TOTAL: TypeTotal = { ms: 0, timed: 0, untimed: 0 }

function own_ms(call: ToolCall, paused: ReadonlyArray<PausedSpan>): number {
	const duration = call.duration_ms ?? 0
	const end = call.started_ms + duration

	return duration - lane_paused_spans.overlap_ms(paused, call.started_ms, end)
}

function added(total: TypeTotal, call: ToolCall, paused: ReadonlyArray<PausedSpan>): TypeTotal {
	return {
		ms: total.ms + own_ms(call, paused),
		timed: total.timed + (call.duration_ms === undefined ? 0 : 1),
		untimed: total.untimed + (call.background ? 1 : 0),
	}
}

// Each agent type's summed time and backgrounded count over one lane's implement calls.
function lane_types(lane: ImplementLane): ReadonlyMap<string, TypeTotal> {
	const types = new Map<string, TypeTotal>()

	for (const call of lane.calls) {
		const type = call.subagent?.type

		if (type !== undefined) types.set(type, added(types.get(type) ?? NO_TOTAL, call, lane.paused))
	}

	return types
}

// The type's row: its timed lanes, their median and max, and its backgrounded calls over every lane.
function type_row(type: string, totals: ReadonlyArray<TypeTotal>): Array<string> {
	const values = totals.filter((total) => total.timed > 0).map((total) => total.ms)
	const untimed = totals.reduce((sum, total) => sum + total.untimed, 0)

	return [
		`subagent: ${type}`,
		String(values.length),
		lane_stage_stats.cell(lane_stats.median(values)),
		lane_stage_stats.cell(lane_stats.peak(values)),
		String(untimed),
	]
}

// One row per agent type any lane dispatched, by name; its lanes are the lanes that dispatched it.
function rows(lanes: ReadonlyArray<ImplementLane>): Array<Array<string>> {
	const per_lane = lanes.map((lane) => lane_types(lane))
	const types = [...new Set(per_lane.flatMap((types_of) => [...types_of.keys()]))].toSorted(
		(left, right) => left.localeCompare(right),
	)

	return types.map((type) =>
		type_row(
			type,
			per_lane.flatMap((types_of) => types_of.get(type) ?? []),
		),
	)
}

const lane_implement_subagents = { rows }

export type { ImplementLane }
export { lane_implement_subagents }
