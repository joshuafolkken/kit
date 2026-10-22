import { run_board_estimate_schedule, type Lanes } from './run-board-estimate-schedule'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import { run_board_phase, type Phase } from './run-board-phase'
import type { ItemStatus } from './run-board-status'
import type { UsualTimes } from './run-board-usual'

// How long the run has left, from how long each phase usually takes (`run-board-usual.ts`,
// joshuafolkken/kit#4044). A running child has left what remains of its phase and every phase it has
// not reached; a waiting child the plan's waves hold takes one child's usual time, stacked onto the
// lane that frees first once what it waits on has ended (`run-board-estimate-schedule.ts`). A parked
// child, and one the plan has not reached — a start date or a blocker ahead of it — wait on something
// no usual time measures, so they are left out. Without a usual time nothing is estimated.

const { HEADER_ICONS, WORDS, minute_span_of } = run_board_labels
const LEGEND = `${HEADER_ICONS.estimate} ${WORDS.estimate}`
const ESTIMATE_MARK = '~'
// A failed ship sends its child back to implement, so it has that phase and every later one left.
const FAILED_PHASE: Phase = 'failed'
const RESUMED_PHASE: Phase = 'implement'
// The phases a child passes in order, a failed ship aside.
const PATH: ReadonlyArray<Phase> = run_board_phase.PHASES.filter((phase) => phase !== FAILED_PHASE)
const MIN_LANES = 1

interface EstimateRead {
	now_ms: number
	ended_ms: number | undefined
	layout: BoardLayout | undefined
	usual?: UsualTimes | undefined
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

// What a running child has left: its phase's usual time less what it has spent there, then every
// phase after it.
function running_left(row: BoardRow, read: EstimateRead, usual: UsualTimes): number {
	const phase = phase_of(row.status)
	const spent = read.now_ms - (row.status?.phase_ms ?? read.now_ms)
	const current = Math.max(0, (usual.get(phase) ?? 0) - spent)

	return current + usual_sum(PATH.slice(PATH.indexOf(phase) + 1), usual)
}

// The queued rows a lane will take, a decision a person owes left out.
function waiting_rows(layout: BoardLayout): Array<BoardRow> {
	const queued: BoardLayout = { ...run_board_layout.EMPTY_LAYOUT, queued: layout.queued }

	return run_board_layout.rows_of(queued).filter((row) => row.state === 'waiting')
}

// The lanes as the running children leave them: each running child's end, the free lanes at zero, and
// a running `run:solo` child's end as the floor no waiting child starts before.
function lanes_of(running: ReadonlyArray<BoardRow>, read: EstimateRead, usual: UsualTimes): Lanes {
	const ends = new Map(running.map((row) => [row.number, running_left(row, read, usual)]))
	const count = Math.max(read.lane_limit ?? running.length, running.length, MIN_LANES)
	const free = [...ends.values(), ...Array.from({ length: count - ends.size }, () => 0)]
	const solo = running.filter((row) => row.is_solo === true).map((row) => ends.get(row.number) ?? 0)

	return { free, ends, floor: Math.max(0, ...solo), per_child: usual_sum(PATH, usual) }
}

// How long the run has left, `undefined` where nothing is left to run or no usual time is known.
function left_ms(read: EstimateRead): number | undefined {
	const { layout, usual } = read

	if (layout === undefined || usual === undefined || usual.size === 0) return undefined

	const running = layout.active.filter((row) => row.state === 'running')
	const waiting = waiting_rows(layout)

	if (running.length + waiting.length === 0) return undefined

	return run_board_estimate_schedule.end_of(waiting, lanes_of(running, read, usual))
}

// `🎯 ~25′`, `undefined` for an ended run or one with nothing to estimate.
function part_of(read: EstimateRead): string | undefined {
	const left = read.ended_ms === undefined ? left_ms(read) : undefined

	return left === undefined
		? undefined
		: `${HEADER_ICONS.estimate} ${ESTIMATE_MARK}${minute_span_of(left)}`
}

const run_board_estimate = { LEGEND, left_ms, part_of }

export { run_board_estimate }
export type { EstimateRead }
