import { lane_state } from '#scripts/lane/lane-state'
import { run_board_kind } from './run-board-kind'
import type { BoardRow, RowRead } from './run-board-layout'
import type { ItemStatus } from './run-board-status'

// The lanes on `run:board` that are not this run's (joshuafolkken/kit#4200, #4260, #4269): an earlier
// run's lane that still holds a place under the limit, drawn after the run's own lanes with what its
// record and the stream say it is doing — its phase, its time, its usage and its newest activity, as a
// row of this run's is — and a lane with no lane state record, drawn unknown. Neither is ever counted
// as this run's.

// The earlier run's lanes still holding a place, what each is doing, and the open lanes with no record.
interface EarlierLanes {
	lanes: ReadonlyArray<string>
	statuses?: ReadonlyMap<number, ItemStatus> | undefined
	unknown?: ReadonlyArray<string> | undefined
}

const NO_EARLIER: EarlierLanes = { lanes: [] }

// What an unknown lane's row says after its title: the command that writes its record.
const BACKFILL_TAIL = lane_state.BACKFILL_HINT

// The mark an earlier run's running lane leads with in place of its phase (joshuafolkken/kit#4269),
// two columns wide as every row icon is (`run-board-labels.ts`, kept out of it by its size).
const EARLIER_ICON = '🧳'

// A child working now — this run's, or an earlier run's lane holding a place.
function is_live(row: BoardRow): boolean {
	return row.state === 'running'
}

function base_row(
	number: number,
	read: RowRead,
): Pick<BoardRow, 'number' | 'title' | 'kind' | 'priority'> {
	const labels = read.labels.get(number)

	return {
		number,
		title: read.titles.get(number),
		kind: run_board_kind.kind_of(labels),
		priority: run_board_kind.priority_of(labels),
	}
}

// The row is drawn as its status says, marked as an earlier run's (`is_earlier`).
function earlier_row(number: number, status: ItemStatus | undefined, read: RowRead): BoardRow {
	return {
		...base_row(number, read),
		state: status?.state ?? 'running',
		status,
		waits: [],
		is_earlier: true,
	}
}

function unknown_row(number: number, read: RowRead): BoardRow {
	return {
		...base_row(number, read),
		state: 'unknown',
		status: undefined,
		waits: [],
		reason: { tail: BACKFILL_TAIL },
	}
}

function apart_of(
	lanes: ReadonlyArray<string>,
	statuses: ReadonlyMap<number, ItemStatus>,
): Array<number> {
	return lanes.map(Number).filter((number) => !statuses.has(number))
}

// An earlier run's lane holding a place, then a lane with no record, unless this run has touched its
// issue since.
function rows_of(
	earlier: EarlierLanes,
	statuses: ReadonlyMap<number, ItemStatus>,
	read: RowRead,
): Array<BoardRow> {
	const lanes = apart_of(earlier.lanes, statuses)
	const unknown = apart_of(earlier.unknown ?? [], statuses)

	return [
		...lanes.map((number) => earlier_row(number, earlier.statuses?.get(number), read)),
		...unknown.map((number) => unknown_row(number, read)),
	]
}

const run_board_earlier = { BACKFILL_TAIL, EARLIER_ICON, NO_EARLIER, is_live, rows_of }

export { run_board_earlier }
export type { EarlierLanes }
