import { lane_breakdown, type Breakdown, type Segment, type Stage } from './lane-breakdown'
import { lane_breakdown_implement } from './lane-breakdown-implement'
import { lane_breakdown_pause } from './lane-breakdown-pause'
import { lane_ledger, type LedgerEntry, type ShipLapEntry } from './lane-ledger'
import type { ToolCall } from './lane-transcript-calls'

// What each ship stage of a lane's breakdown spent its time on (joshuafolkken/kit#5294): the laps the
// ship wrote for its inner steps (`run-ship-lap.ts`), the lane's core-budget waits and the checks of
// the lane's gates, each under the stage it ended in, and the time between two ship stages split by
// the park it went to (`lane-breakdown-pause.ts`), else by the Bash the lane child ran there, by the
// implementation's kinds, and the rest as its editing and thinking (`lane-breakdown-implement.ts`).
// A lap and a wait or a check inside it overlap — the gate's wait for cores and its checks, run side
// by side, are part of its `josh gate` lap — so a stage's laps can add up to more.

const { KIND } = lane_ledger
const CORE_WAIT_STEP = 'core-budget wait'

// Each stage's laps, longest first, keyed by the stage's name in the breakdown.
type Laps = ReadonlyMap<string, ReadonlyArray<Stage>>

interface Placed {
	at_ms: number
	part: Stage
}

// A gate the ship reused rather than started (joshuafolkken/kit#5567), counted per stage (`counted`).
const REUSED_NOTE = '(reused)'

// A scoped pair's rerun names its run count; a gate's reason stands alone (joshuafolkken/kit#5567).
function rerun_note(entry: ShipLapEntry): ReadonlyArray<string> {
	if (entry.rerun === undefined) return []

	return [entry.runs === undefined ? entry.rerun : `run ${String(entry.runs)}: ${entry.rerun}`]
}

// Which run of the ship's scoped pair a lap was and why it ran again (joshuafolkken/kit#5538), and why
// a check read the whole branch (joshuafolkken/kit#5531), after the step's name.
function lap_name(entry: ShipLapEntry): string {
	if (entry.reused_tree !== undefined) return `${entry.step} ${REUSED_NOTE}`

	const run = rerun_note(entry)
	const whole = entry.fallback === undefined ? [] : [`whole branch: ${entry.fallback}`]
	const notes = [...run, ...whole]

	return notes.length === 0 ? entry.step : `${entry.step} (${notes.join('; ')})`
}

function lap_of(entry: LedgerEntry, issue: number): ReadonlyArray<Placed> {
	if (entry.kind !== KIND.SHIP_LAP || entry.issue !== issue) return []

	return [{ at_ms: Date.parse(entry.at), part: { name: lap_name(entry), ms: entry.elapsed_ms } }]
}

function wait_of(entry: LedgerEntry, issue: number): ReadonlyArray<Placed> {
	if (entry.kind !== KIND.CORE_WAIT || entry.issue !== issue) return []

	return [{ at_ms: Date.parse(entry.at), part: { name: CORE_WAIT_STEP, ms: entry.waited_ms } }]
}

// Each check the lane's gate ran, placed where the gate ended (joshuafolkken/kit#5319). A row with no
// `issue` — outside a lane, or written before the gate recorded it — is no lane's; a reused check
// started nothing, so its zero is no time spent.
function checks_of(entry: LedgerEntry, issue: number): ReadonlyArray<Placed> {
	if (entry.kind !== KIND.GATE || entry.issue !== issue) return []
	const at_ms = Date.parse(entry.at)

	return (entry.checks ?? [])
		.filter((check) => check.is_reused !== true)
		.map((check) => ({ at_ms, part: { name: check.label, ms: check.elapsed_ms } }))
}

// The ship stage a lap, a wait or a check ended in — never the time between stages, which the ship runs nothing in.
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

// A stage's reused laps under one row carrying their count, `josh gate (reused ×2)`, before
// `lane_breakdown.ranked` sums each name's time into one row.
function counted(parts: ReadonlyArray<Stage>): Array<Stage> {
	const reuses = new Map<string, number>()

	for (const { name } of parts) {
		if (name.endsWith(REUSED_NOTE)) reuses.set(name, (reuses.get(name) ?? 0) + 1)
	}

	return parts.map((part) => {
		const count = reuses.get(part.name)

		return count === undefined
			? part
			: { ...part, name: `${part.name.slice(0, -REUSED_NOTE.length)}(reused ×${String(count)})` }
	})
}

// A stretch between ship stages a park fell in, under the park's row and net of the waits taken out
// (joshuafolkken/kit#5646); a stretch with no park is left to the Bash kinds.
function paused_of(segment: Segment, breakdown: Breakdown): ReadonlyArray<Stage> {
	const mark = lane_breakdown_pause.in_segment(breakdown.pauses ?? [], segment)

	if (mark === undefined) return []
	const waited_ms = lane_breakdown.covered_ms(segment, breakdown.waits)

	return [{ name: mark.name, ms: segment.to_ms - segment.from_ms - waited_ms }]
}

function between_of(calls: ReadonlyArray<ToolCall>, breakdown: Breakdown): Array<Stage> {
	const between = breakdown.ship.filter((segment) => segment.stage === lane_breakdown.BETWEEN_STAGE)
	const paused = between.map((segment) => paused_of(segment, breakdown))
	const unpaused = between.filter((_segment, index) => paused[index]?.length === 0)

	return lane_breakdown.ranked([
		...paused.flat(),
		...lane_breakdown_implement.bash_kinds(calls, unpaused, breakdown.waits),
	])
}

/**
 * `issue`'s ship stages split by their laps, and the time between them by the park it went to, else by
 * the lane child's Bash.
 */
function of(
	entries: ReadonlyArray<LedgerEntry>,
	issue: number,
	breakdown: Breakdown,
	calls: ReadonlyArray<ToolCall>,
): Laps {
	const placed = entries.flatMap((entry) => [
		...lap_of(entry, issue),
		...wait_of(entry, issue),
		...checks_of(entry, issue),
	])
	const laps = new Map(
		[...grouped(placed, breakdown.ship)].map(([stage, parts]) => [
			stage,
			lane_breakdown.ranked(counted(parts)),
		]),
	)
	const between = between_of(calls, breakdown)

	if (between.length > 0) laps.set(lane_breakdown.BETWEEN_STAGE, between)

	return laps
}

const lane_breakdown_laps = { CORE_WAIT_STEP, of }

export { lane_breakdown_laps }
export type { Laps }
