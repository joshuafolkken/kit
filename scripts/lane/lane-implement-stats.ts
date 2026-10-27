import { lane_paused_spans, type PausedSpan, type PausedSpans } from './lane-paused-spans'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// The implement stage broken down by what its time went on (joshuafolkken/kit#4887). The ledger's
// implement is one span per lane, dispatch to the ship's first stage (`lane-stage-stats.ts`); the lane's
// transcript holds every tool call inside it, so each call's span — from the latest end of the session's
// earlier calls to its own, the model's turn before it included — is put to one sub-stage, and `lane:stats` prints each one's
// median over the period's lanes.
//
// **A lane's implement ends at its first `josh ship` call**, so a lane that never shipped in the period
// has no implement here. **`review-fix` runs from `run:review` on** — the round's fixes and their scoped
// checks; before it, an edit is `edit`, a scoped check or gate is `check`, and any other call is `plan`
// before the first edit, `read` after it. **A session's first call spans its own duration**, so the gap
// between two sessions of one lane is nobody's. **Nor is the time the lane stood paused**: a
// `lane:pause` leaves the call in flight on the clock, so its overlap with the lane's paused spans is
// taken out (joshuafolkken/kit#5168).

const SUB_STAGES = ['plan', 'read', 'edit', 'check', 'review-fix'] as const
type SubStage = (typeof SUB_STAGES)[number]
const [PLAN, READ, EDIT, CHECK, REVIEW_FIX] = SUB_STAGES
type Totals = ReadonlyMap<SubStage, number>

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write'])
const CHECK_COMMANDS: ReadonlySet<string> = new Set([
	'check:related',
	'cspell:dot',
	'gate',
	'lint:related',
	'metrics',
	'test:pinned',
	'test:related',
])
const REVIEW_COMMANDS: ReadonlySet<string> = new Set(['review:brief', 'run:review'])
const SHIP_COMMANDS: ReadonlySet<string> = new Set(['ship'])
const COLUMNS = ['implement sub-stage', 'lanes', 'median (min)', 'max (min)'] as const

interface Phase {
	edited: boolean
	reviewing: boolean
}

// The latest end of the calls seen so far in one session; calls run side by side overlap.
interface Reach {
	session_id: ToolCall['session_id'] | undefined
	end_ms: number
}

const NO_REACH: Reach = { session_id: undefined, end_ms: 0 }

function runs_any(call: ToolCall, names: ReadonlySet<string>): boolean {
	return lane_transcript_stats.josh_commands(call.command).some((name) => names.has(name))
}

function is_edit(call: ToolCall): boolean {
	return EDIT_TOOLS.has(call.tool ?? '')
}

// The phase once `call` ran: an edit, or a review started, holds for the rest of the lane.
function next_phase(call: ToolCall, phase: Phase): Phase {
	return {
		edited: phase.edited || is_edit(call),
		reviewing: phase.reviewing || runs_any(call, REVIEW_COMMANDS),
	}
}

function sub_stage_of(call: ToolCall, phase: Phase): SubStage {
	if (phase.reviewing) return REVIEW_FIX
	if (is_edit(call)) return EDIT
	if (runs_any(call, CHECK_COMMANDS)) return CHECK

	return phase.edited ? READ : PLAN
}

function end_ms(call: ToolCall): number {
	return call.started_ms + (call.duration_ms ?? 0)
}

function span_ms(call: ToolCall, reach: Reach): number {
	if (reach.session_id !== call.session_id) return call.duration_ms ?? 0

	return Math.max(0, end_ms(call) - reach.end_ms)
}

function next_reach(call: ToolCall, reach: Reach): Reach {
	const latest = reach.session_id === call.session_id ? reach.end_ms : 0

	return { session_id: call.session_id, end_ms: Math.max(latest, end_ms(call)) }
}

// The call's span less the time its lane stood paused inside it.
function active_ms(call: ToolCall, reach: Reach, paused: ReadonlyArray<PausedSpan>): number {
	const span = span_ms(call, reach)
	const end = end_ms(call)

	return span - lane_paused_spans.overlap_ms(paused, end - span, end)
}

// Each sub-stage's summed span over one lane's implement calls, oldest first.
function lane_totals(calls: ReadonlyArray<ToolCall>, paused: ReadonlyArray<PausedSpan>): Totals {
	const totals = new Map<SubStage, number>(SUB_STAGES.map((stage) => [stage, 0]))
	let phase: Phase = { edited: false, reviewing: false }
	let reach = NO_REACH

	for (const call of calls) {
		phase = next_phase(call, phase)
		const stage = sub_stage_of(call, phase)

		totals.set(stage, (totals.get(stage) ?? 0) + active_ms(call, reach, paused))
		reach = next_reach(call, reach)
	}

	return totals
}

// One lane's calls before its first ship, or `undefined` when it never shipped.
function implement_calls(calls: ReadonlyArray<ToolCall>): ReadonlyArray<ToolCall> | undefined {
	const ship = calls.findIndex((call) => runs_any(call, SHIP_COMMANDS))

	return ship === -1 ? undefined : calls.slice(0, ship)
}

function lanes_of(calls: ReadonlyArray<ToolCall>): Array<ReadonlyArray<ToolCall>> {
	const lanes = [...new Set(calls.map((call) => call.lane))]

	return lanes.map((lane) =>
		calls
			.filter((call) => call.lane === lane)
			.toSorted((left, right) => left.started_ms - right.started_ms),
	)
}

// The sub-stage totals of each lane that shipped in `window`.
function lane_totals_in(
	calls: ReadonlyArray<ToolCall>,
	window: StatsWindow,
	paused: PausedSpans,
): Array<Totals> {
	return lanes_of(lane_transcript_stats.in_period(calls, window)).flatMap((lane) => {
		const implement = implement_calls(lane)
		const spans = lane_paused_spans.of_lane(paused, lane[0]?.lane ?? '')

		return implement === undefined ? [] : [lane_totals(implement, spans)]
	})
}

function stage_row(stage: SubStage, totals: ReadonlyArray<Totals>): Array<string> {
	const values = totals.map((lane) => lane.get(stage) ?? 0)

	return [
		stage,
		String(values.length),
		lane_stage_stats.cell(lane_stats.median(values)),
		lane_stage_stats.cell(lane_stats.peak(values)),
	]
}

// The period's table: `calls` is every lane session's calls, filtered here to `window`; `paused` is
// each lane's paused spans (`lane-paused-spans.ts`).
function table(calls: ReadonlyArray<ToolCall>, window: StatsWindow, paused: PausedSpans): string {
	const totals = lane_totals_in(calls, window, paused)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...SUB_STAGES.map((stage) => lane_stats.to_row(stage_row(stage, totals))),
	].join('\n')
}

const lane_implement_stats = { SUB_STAGES, lane_totals_in, table }

export type { SubStage }
export { lane_implement_stats }
