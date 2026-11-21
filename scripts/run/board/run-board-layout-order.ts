import type { BoardRow } from './run-board-layout-types'
import type { ItemState } from './run-board-status'

// The order the board's rows are drawn in (`run-board-layout.ts`), and the states that order reads.

// A child that has ended for good — drawn in the done section rather than the leading one.
const FINISHED_STATES: ReadonlySet<ItemState> = new Set([
	'merged',
	'done',
	'already_done',
	'withdrawn',
])
// The finished ones and a parked one: what has stopped moving.
const SETTLED_STATES: ReadonlySet<ItemState> = new Set([...FINISHED_STATES, 'parked'])

function is_settled(state: ItemState): boolean {
	return SETTLED_STATES.has(state)
}

function is_finished(state: ItemState): boolean {
	return FINISHED_STATES.has(state)
}

// Running rows first, then the parked and stopped ones, then the finished ones. A row parked on a
// decision ranks among the parked, though the render draws it in its own 🙋 section.
function rank_of(row: BoardRow): number {
	if (row.state === 'running') return 0

	return is_finished(row.state) ? Infinity : 1
}

// A finished row sorts by its end, the newest first and one with none last; any other by its start.
function key_of(row: BoardRow): number {
	const { started_ms = Infinity, ended_ms = -Infinity } = row.status ?? {}

	return is_finished(row.state) ? -ended_ms : started_ms
}

function compared(left: number, right: number): number {
	if (left === right) return 0

	return left < right ? -1 : 1
}

function active_order(left: BoardRow, right: BoardRow): number {
	return compared(rank_of(left), rank_of(right)) || compared(key_of(left), key_of(right))
}

// A row waiting on no start time keeps its plan place ahead of every 📅 row, which follow from the
// earliest start (joshuafolkken/kit#4104).
function start_order(left: BoardRow, right: BoardRow): number {
	const { not_before_ms: left_ms = -Infinity } = left.reason ?? {}
	const { not_before_ms: right_ms = -Infinity } = right.reason ?? {}

	return compared(left_ms, right_ms)
}

const run_board_layout_order = { active_order, is_finished, is_settled, start_order }

export { run_board_layout_order }
