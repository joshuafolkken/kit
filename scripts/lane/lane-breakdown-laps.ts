import { lane_breakdown, type Breakdown, type Segment, type Stage } from './lane-breakdown'
import { lane_breakdown_implement } from './lane-breakdown-implement'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import type { ToolCall } from './lane-transcript-calls'

// What each ship stage of a lane's breakdown spent its time on (joshuafolkken/kit#5294): the laps the
// ship wrote for its inner steps (`run-ship-lap.ts`) and the lane's core-budget waits, each under the
// stage it ended in, and the time between two ship stages split by the Bash the lane child ran there,
// by the implementation's kinds (`lane-breakdown-implement.ts`). A lap and a wait inside it overlap —
// the gate's wait for cores is part of its `josh gate` lap — so a stage's laps can add up to more.

const { KIND } = lane_ledger
const CORE_WAIT_STEP = 'core-budget wait'

// Each stage's laps, longest first, keyed by the stage's name in the breakdown.
type Laps = ReadonlyMap<string, ReadonlyArray<Stage>>

interface Placed {
	at_ms: number
	part: Stage
}

function lap_of(entry: LedgerEntry, issue: number): ReadonlyArray<Placed> {
	if (entry.kind !== KIND.SHIP_LAP || entry.issue !== issue) return []

	return [{ at_ms: Date.parse(entry.at), part: { name: entry.step, ms: entry.elapsed_ms } }]
}

function wait_of(entry: LedgerEntry, issue: number): ReadonlyArray<Placed> {
	if (entry.kind !== KIND.CORE_WAIT || entry.issue !== issue) return []

	return [{ at_ms: Date.parse(entry.at), part: { name: CORE_WAIT_STEP, ms: entry.waited_ms } }]
}

// The ship stage a lap or a wait ended in — never the time between stages, which the ship runs nothing in.
function stage_at(segments: ReadonlyArray<Segment>, at_ms: number): string | undefined {
	const segment = segments.find((span) => at_ms > span.from_ms && at_ms <= span.to_ms)

	return segment?.stage === lane_breakdown.BETWEEN_STAGE ? undefined : segment?.stage
}

function grouped(
	placed: ReadonlyArray<Placed>,
	segments: ReadonlyArray<Segment>,
): Map<string, Array<Stage>> {
	const groups = new Map<string, Array<Stage>>()

	for (const { at_ms, part } of placed) {
		const stage = stage_at(segments, at_ms)

		if (stage !== undefined) groups.set(stage, [...(groups.get(stage) ?? []), part])
	}

	return groups
}

function between_of(
	calls: ReadonlyArray<ToolCall>,
	segments: ReadonlyArray<Segment>,
): Array<Stage> {
	const between = segments.filter((segment) => segment.stage === lane_breakdown.BETWEEN_STAGE)

	return lane_breakdown_implement.bash_kinds(calls, between)
}

/** `issue`'s ship stages split by their laps, and the time between them by the lane child's Bash. */
function of(
	entries: ReadonlyArray<LedgerEntry>,
	issue: number,
	breakdown: Breakdown,
	calls: ReadonlyArray<ToolCall>,
): Laps {
	const placed = entries.flatMap((entry) => [...lap_of(entry, issue), ...wait_of(entry, issue)])
	const laps = new Map(
		[...grouped(placed, breakdown.ship)].map(([stage, parts]) => [
			stage,
			lane_breakdown.ranked(parts),
		]),
	)
	const between = between_of(calls, breakdown.ship)

	if (between.length > 0) laps.set(lane_breakdown.BETWEEN_STAGE, between)

	return laps
}

const lane_breakdown_laps = { CORE_WAIT_STEP, of }

export { lane_breakdown_laps }
export type { Laps }
