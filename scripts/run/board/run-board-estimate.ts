import { run_board_estimate_schedule, type Lanes } from './run-board-estimate-schedule'
import { run_board_labels } from './run-board-labels'
import { run_board_lane_totals, type LaneTotals } from './run-board-lane-totals'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import { run_board_phase, type Phase } from './run-board-phase'
import type { ItemStatus } from './run-board-status'
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
const ESTIMATE_MARK = '~'
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

function usual_sum(phases: ReadonlyArray<Phase>, usual: UsualTimes): number {
	return phases.reduce((sum, phase) => sum + (usual.get(phase) ?? 0), 0)
}

// The phase a child stands at, as the path counts it.
function phase_of(status: ItemStatus | undefined): Phase {
	const phase = status?.track?.at(-1) ?? run_board_phase.LAUNCHED_PHASE

	return phase === FAILED_PHASE ? RESUMED_PHASE : phase
}

// What a child longer than every measured lane has left: its phase's usual time less what it has spent
// there, then every phase after it — more than zero short of its last phase.
function phase_left(row: BoardRow, read: EstimateRead): number {
	const usual = read.usual ?? NO_USUAL
	const phase = phase_of(row.status)
	const spent = read.now_ms - (row.status?.phase_ms ?? read.now_ms)
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

// How long the run has left, `undefined` where nothing is left to run or no lane total is measured.
function left_ms(read: EstimateRead): number | undefined {
	const { layout } = read
	const totals = read.lane_totals ?? []

	if (layout === undefined || totals.length === 0) return undefined

	const running = layout.active.filter((row) => row.state === 'running')
	const waiting = waiting_rows(layout)

	if (running.length + waiting.length === 0) return undefined

	return run_board_estimate_schedule.end_of(waiting, lanes_of(running, read, totals))
}

// The local finish time, with its `MM-DD` when it falls on another day than now.
function finish_of(now_ms: number, finish_ms: number): string {
	const is_today = new Date(now_ms).toDateString() === new Date(finish_ms).toDateString()

	return is_today ? minute_of(finish_ms) : day_minute_of(finish_ms)
}

// `🎯 ~14:32`, `🎯 ~10-19 02:05` on another day; `undefined` for an ended run or nothing to estimate.
function part_of(read: EstimateRead): string | undefined {
	const left = read.ended_ms === undefined ? left_ms(read) : undefined

	return left === undefined
		? undefined
		: `${HEADER_ICONS.estimate} ${ESTIMATE_MARK}${finish_of(read.now_ms, read.now_ms + left)}`
}

const run_board_estimate = { LEGEND, left_ms, part_of }

export { run_board_estimate }
export type { EstimateRead }
