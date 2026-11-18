import type { RunActivity } from './run-board-activity'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_layout, type BoardLayout } from './run-board-layout'
import type { QuotaHold } from './run-board-render-quota'

// The alert level a themed board draws at the end of the header's second line, `DEFCON 5 4 [3] 2 1`:
// 5 is calm, 1 the worst, and the lowest level whose condition holds is the one lit. A full set of lanes
// with a `P1` waiting behind them is the usual board, so it stays calm: only a `P1` waiting beside a free
// lane, or more lanes running than the limit, raises the level (joshuafolkken/kit#7989).

const LABEL = 'DEFCON'

// What the level is read from — the header's own fields.
interface DefconRead {
	activity: Pick<RunActivity, 'is_stopped'>
	// The usage limit or authentication failure holding the run's launches.
	quota_hold?: QuotaHold | undefined
	// When the reads off this machine last failed.
	read_failed_ms?: number | undefined
	layout: BoardLayout | undefined
	lane_limit?: number | undefined
}

function layout_of(read: DefconRead): BoardLayout {
	return read.layout ?? run_board_layout.EMPTY_LAYOUT
}

// Lanes the limit leaves free: negative past it, none where no limit was read.
function spare_lanes(read: DefconRead): number {
	const running = layout_of(read).active.filter((row) => row.state === 'running').length

	return (read.lane_limit ?? running) - running
}

// 1: the whole run is held — stopped, out of its usage, or blind to its own reads.
function is_halted(read: DefconRead): boolean {
	const is_held = read.quota_hold !== undefined || read.read_failed_ms !== undefined

	return read.activity.is_stopped || is_held
}

// 2: a person is asked to decide.
function is_asking(read: DefconRead): boolean {
	return run_board_layout.people_of(layout_of(read)).length > 0
}

// 3: a `P1` waits while a lane is free.
function is_critical_idle(read: DefconRead): boolean {
	const queued = run_board_layout.queued_rows(layout_of(read))

	return spare_lanes(read) > 0 && queued.some((row) => row.priority === 'critical')
}

// 4: more lanes run than the limit allows.
function is_over_limit(read: DefconRead): boolean {
	return spare_lanes(read) < 0
}

// Each rule from level 1 up, so the first that holds is the lowest level.
const RULES: ReadonlyArray<(read: DefconRead) => boolean> = [
	is_halted,
	is_asking,
	is_critical_idle,
	is_over_limit,
]

// Each level's color from 1 up: red for 1 and 2, amber for 3 and 4, green for 5.
const COLORS: ReadonlyArray<Paint> = ['red', 'red', 'yellow', 'yellow', 'green']

function level_of(read: DefconRead): number {
	const index = RULES.findIndex((rule) => rule(read))

	return (index === -1 ? RULES.length : index) + 1
}

function step_of(color: Paint, step: number, level: number): string {
	const text = String(step)

	return step === level ? run_board_labels.painted(color, `[${text}]`) : text
}

// The levels from 5 down, the current one alone bracketed and colored.
function field_of(level: number): string {
	const steps = COLORS.map((color, index) => step_of(color, index + 1, level)).toReversed()

	return [LABEL, ...steps].join(' ')
}

const run_board_header_defcon = { field_of, level_of }

export { run_board_header_defcon }
export type { DefconRead }
