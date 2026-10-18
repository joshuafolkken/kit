import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import { run_board_phase, type Phase } from './run-board-phase'
import type { ItemStatus } from './run-board-status'
import type { UsualTimes } from './run-board-usual'

// How long the run has left, from how long each phase usually takes (`run-board-usual.ts`,
// joshuafolkken/kit#4044). A running child has left what remains of its phase and every phase it has
// not reached; a waiting child the plan's waves hold takes one child's usual time, stacked onto the
// lane that frees first. A parked child, and one the plan has not reached — a start date or a blocker
// ahead of it — wait on something no usual time measures, so they are left out. Without a usual time
// nothing is estimated.

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
function waiting_count(layout: BoardLayout): number {
	const queued: BoardLayout = { ...run_board_layout.EMPTY_LAYOUT, queued: layout.queued }

	return run_board_layout.rows_of(queued).filter((row) => row.state === 'waiting').length
}

// Each lane's time to its end: a running child's, then each waiting child's onto the lane free first.
function lanes_end(running: ReadonlyArray<number>, waiting: number, read: EstimateRead): number {
	const lanes = Math.max(read.lane_limit ?? running.length, running.length, MIN_LANES)
	const ends = [...running, ...Array.from({ length: lanes - running.length }, () => 0)]
	const per_child = read.usual === undefined ? 0 : usual_sum(PATH, read.usual)

	for (let index = 0; index < waiting; index++) {
		const first = ends.indexOf(Math.min(...ends))

		ends[first] = (ends[first] ?? 0) + per_child
	}

	return Math.max(...ends)
}

// How long the run has left, `undefined` where nothing is left to run or no usual time is known.
function left_ms(read: EstimateRead): number | undefined {
	const { layout, usual } = read

	if (layout === undefined || usual === undefined || usual.size === 0) return undefined

	const rows = layout.active.filter((row) => row.state === 'running')
	const running = rows.map((row) => running_left(row, read, usual))
	const waiting = waiting_count(layout)

	return running.length + waiting === 0 ? undefined : lanes_end(running, waiting, read)
}

// `🏁 ~25′`, `undefined` for an ended run or one with nothing to estimate.
function part_of(read: EstimateRead): string | undefined {
	const left = read.ended_ms === undefined ? left_ms(read) : undefined

	return left === undefined
		? undefined
		: `${HEADER_ICONS.estimate} ${ESTIMATE_MARK}${minute_span_of(left)}`
}

const run_board_estimate = { LEGEND, left_ms, part_of }

export { run_board_estimate }
export type { EstimateRead }
