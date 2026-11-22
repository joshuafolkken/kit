import { lane_host_gaps } from '#scripts/lane/lane-host-gaps'
import {
	run_board_estimate_schedule,
	type Lanes,
	type Placement,
} from './run-board-estimate-schedule'
import { run_board_labels } from './run-board-labels'
import { run_board_lane_totals, type LaneTotals } from './run-board-lane-totals'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import { run_board_phase, type Phase } from './run-board-phase'
import type { ItemState, ItemStatus } from './run-board-status'
import type { UsualTimes } from './run-board-usual'

// When the run should finish, from how long lanes took from dispatch to merge
// (`run-board-lane-totals.ts`, joshuafolkken/kit#7770; joshuafolkken/kit#4044 summed each phase's usual
// time once, which left out retried ships and the waits between phases). A running child has left the
// median of what the lanes that ran longer than it took beyond its time so far; one already longer
// than every measured lane falls back to what its phase and the phases after it usually take
// (`run-board-usual.ts`). A waiting child the plan's waves hold takes the median total, stacked onto
// the lane that frees first once what it waits on has ended (`run-board-estimate-schedule.ts`). A
// parked child, and one the plan has not reached — a start date or a blocker ahead of it — wait on
// something no total measures, so they are left out. Without a measured total nothing is estimated.

const { HEADER_ICONS, WORDS, day_minute_of, minute_of } = run_board_labels
const LEGEND = `${HEADER_ICONS.estimate} ${WORDS.estimate}`
// A row whose finish nothing measures.
const UNKNOWN = `${HEADER_ICONS.estimate} —`
const FINISH_STATES: ReadonlySet<ItemState> = new Set(['running', 'parked'])
// A failed ship sends its child back to implement, so it has that phase and every later one left.
const FAILED_PHASE: Phase = 'failed'
const RESUMED_PHASE: Phase = 'implement'
// The phases a child passes in order, a failed ship aside.
const PATH: ReadonlyArray<Phase> = run_board_phase.PHASES.filter((phase) => phase !== FAILED_PHASE)
const MIN_LANES = 1
const NO_USUAL: UsualTimes = new Map()

interface EstimateRead {
	now_ms: number
	ended_ms: number | undefined
	layout: BoardLayout | undefined
	usual?: UsualTimes | undefined
	lane_totals?: LaneTotals | undefined
	lane_limit?: number | undefined
}

// What says the run still moves, as the board's header carries it.
interface RunMotion {
	ended_ms: number | undefined
	activity: { is_stopped: boolean }
}

interface RowFinish {
	finish_ms: number
	drift_ms: number
}

function usual_sum(phases: ReadonlyArray<Phase>, usual: UsualTimes): number {
	return phases.reduce((sum, phase) => sum + (usual.get(phase) ?? 0), 0)
}

// The phase a child stands at, as the path counts it.
function phase_of(status: ItemStatus | undefined): Phase {
	const phase = status?.track?.at(-1) ?? run_board_phase.LAUNCHED_PHASE

	return phase === FAILED_PHASE ? RESUMED_PHASE : phase
}

/**
 * How long a child has stood at its phase up to `end_ms`, the host's stops in its `gaps` left out as
 * the usual times leave them out (joshuafolkken/kit#7905); `undefined` where no event said when it got
 * there.
 */
function phase_spent(status: ItemStatus | undefined, end_ms: number): number | undefined {
	const phase_ms = status?.phase_ms

	if (phase_ms === undefined) return undefined

	const stopped_ms = lane_host_gaps.excluded_ms(status?.gaps ?? [], [
		{ from_ms: phase_ms, to_ms: end_ms },
	])

	return end_ms - phase_ms - stopped_ms
}

// What a child longer than every measured lane has left: its phase's usual time less what it has spent
// there, then every phase after it — more than zero short of its last phase.
function phase_left(row: BoardRow, read: EstimateRead): number {
	const usual = read.usual ?? NO_USUAL
	const phase = phase_of(row.status)
	const spent = phase_spent(row.status, read.now_ms) ?? 0
	const current = Math.max(0, (usual.get(phase) ?? 0) - spent)

	return current + usual_sum(PATH.slice(PATH.indexOf(phase) + 1), usual)
}

// A child's latest launch, as the ledger times a lane from its latest dispatch; now for one not read.
function launch_of(status: ItemStatus | undefined, now_ms: number): number {
	return status?.launched_ms ?? status?.started_ms ?? now_ms
}

// What a running child has left, from the time it has run in its lane.
function running_left(row: BoardRow, read: EstimateRead, totals: LaneTotals): number {
	const launched_ms = launch_of(row.status, read.now_ms)

	return (
		run_board_lane_totals.running_left_ms(totals, read.now_ms - launched_ms) ??
		phase_left(row, read)
	)
}

// The queued rows a lane will take, a decision a person owes left out.
function waiting_rows(layout: BoardLayout): Array<BoardRow> {
	const queued: BoardLayout = { ...run_board_layout.EMPTY_LAYOUT, queued: layout.queued }

	return run_board_layout.rows_of(queued).filter((row) => row.state === 'waiting')
}

// The lanes as the running children leave them: each running child's end, the free lanes at zero, and
// a running `run:solo` child's end as the floor no waiting child starts before.
function lanes_of(running: ReadonlyArray<BoardRow>, read: EstimateRead, totals: LaneTotals): Lanes {
	const ends = new Map(running.map((row) => [row.number, running_left(row, read, totals)]))
	const count = Math.max(read.lane_limit ?? running.length, running.length, MIN_LANES)
	const free = [...ends.values(), ...Array.from({ length: count - ends.size }, () => 0)]
	const solo = running.filter((row) => row.is_solo === true).map((row) => ends.get(row.number) ?? 0)
	const per_child = run_board_lane_totals.waiting_ms(totals) ?? 0

	return { free, ends, floor: Math.max(0, ...solo), per_child }
}

// Whether this run's lane totals foretell the row: not an earlier run's lane (🧳), nor one this run took
// over from an ended run (joshuafolkken/kit#8455) — its time began under that run.
function is_foretold(row: BoardRow): boolean {
	return row.is_earlier !== true && row.status?.is_adopted !== true
}

// The waiting children placed on the lanes the running ones leave, `undefined` where nothing is left to
// run or no lane total is measured.
function placement_of(read: EstimateRead): Placement | undefined {
	const { layout } = read
	const totals = read.lane_totals ?? []

	if (layout === undefined || totals.length === 0) return undefined

	const running = layout.active.filter((row) => row.state === 'running' && is_foretold(row))
	const waiting = waiting_rows(layout)

	if (running.length + waiting.length === 0) return undefined

	return run_board_estimate_schedule.placed_of(waiting, lanes_of(running, read, totals))
}

// How long the run has left, `undefined` where nothing is left to run or no lane total is measured.
function left_ms(read: EstimateRead): number | undefined {
	return placement_of(read)?.end
}

// When a queued child should finish (epoch ms), from the same placement the run's finish reads;
// `undefined` for a child the lanes do not take — a blocker or start date ahead of it, a decision a
// person owes, one not queued — or where no lane total is measured.
function queued_finish_ms(read: EstimateRead, number: number): number | undefined {
	const end = placement_of(read)?.ends.get(number)

	return end === undefined ? undefined : read.now_ms + end
}

// When one running child should finish, from the same lane totals the run's finish reads
// (joshuafolkken/kit#7920), and how far that has moved from what its launch alone foretold — the median
// lane total after it. `undefined` where no lane total is measured.
function row_finish(row: BoardRow, read: EstimateRead): RowFinish | undefined {
	const totals = read.lane_totals ?? []

	if (totals.length === 0) return undefined

	const finish_ms = read.now_ms + running_left(row, read, totals)
	const foretold_ms =
		launch_of(row.status, read.now_ms) + (run_board_lane_totals.waiting_ms(totals) ?? 0)

	return { finish_ms, drift_ms: finish_ms - foretold_ms }
}

// Whether a row ends on its finish (joshuafolkken/kit#7920): a running row, and a parked one, while the
// run goes on; a row waiting on a person draws none, its finish never measured (joshuafolkken/kit#8166) — a stopped or ended run's header draws no 🎯, nor do its rows. An
// earlier run's lane (🧳), or an adopted one, draws none: this run's lane totals do not foretell it.
function is_finish_drawn(row: BoardRow, run: RunMotion): boolean {
	const is_moving = run.ended_ms === undefined && !run.activity.is_stopped

	return is_moving && is_foretold(row) && FINISH_STATES.has(row.state)
}

// The local finish time, with its `MM-DD` when it falls on another day than now.
function finish_of(now_ms: number, finish_ms: number): string {
	const is_today = new Date(now_ms).toDateString() === new Date(finish_ms).toDateString()

	return is_today ? minute_of(finish_ms) : day_minute_of(finish_ms)
}

// `🎯 14:32`, `🎯 10-19 02:05` on another day — no `~`, the 🎯 says it is an estimate
// (joshuafolkken/kit#8478).
function stamp_of(now_ms: number, finish_ms: number): string {
	return `${HEADER_ICONS.estimate} ${finish_of(now_ms, finish_ms)}`
}

const run_board_estimate = {
	LEGEND,
	UNKNOWN,
	is_finish_drawn,
	left_ms,
	phase_spent,
	queued_finish_ms,
	row_finish,
	stamp_of,
}

export { run_board_estimate }
export type { EstimateRead, RowFinish }
