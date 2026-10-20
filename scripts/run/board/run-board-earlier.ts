import { run_board_kind } from './run-board-kind'
import type { BoardRow, RowRead } from './run-board-layout'
import type { ItemState, ItemStatus } from './run-board-status'

// An earlier run's lanes on `run:board` (joshuafolkken/kit#4200, #4260): each still holds a place under
// the limit, so its row is drawn after the run's own lanes with what the stream says it is doing — its
// phase, its time, its usage and its newest activity — and never counted as this run's.

// The earlier run's lanes still holding a place, and what the stream says each is doing.
interface EarlierLanes {
	lanes: ReadonlyArray<string>
	statuses?: ReadonlyMap<number, ItemStatus> | undefined
}

const NO_EARLIER: EarlierLanes = { lanes: [] }

// A child working now: this run's running one, and an earlier run's lane holding a place — drawn
// alike, the earlier one never counted as this run's.
const LIVE_STATES: ReadonlySet<ItemState> = new Set(['running', 'earlier'])

function is_live(row: BoardRow): boolean {
	return LIVE_STATES.has(row.state)
}

// The row stays 🧳 while its lane runs, and is drawn paused as this run's own is.
function earlier_row(number: number, status: ItemStatus | undefined, read: RowRead): BoardRow {
	return {
		number,
		title: read.titles.get(number),
		kind: run_board_kind.kind_of(read.labels.get(number)),
		state: status?.state === 'paused' ? 'paused' : 'earlier',
		status,
		waits: [],
	}
}

// An earlier run's lane holding a place, unless this run has touched its issue since.
function rows_of(
	earlier: EarlierLanes,
	statuses: ReadonlyMap<number, ItemStatus>,
	read: RowRead,
): Array<BoardRow> {
	const numbers = earlier.lanes.map(Number).filter((number) => !statuses.has(number))

	return numbers.map((number) => earlier_row(number, earlier.statuses?.get(number), read))
}

// This run's statuses without an earlier run's lane the span holds no launch of: a cut, a resume or an
// ending its child wrote after this run began is the earlier run's, so its row stays 🧳 and is never
// counted as this run's. A launch in the span makes the lane this run's. A child of this run whose
// launch rolled off the stream holds a lane dispatched after the run began, so it is no earlier lane.
function own_statuses(
	statuses: ReadonlyMap<number, ItemStatus>,
	earlier: ReadonlyArray<string> | undefined,
): ReadonlyMap<number, ItemStatus> {
	const lanes = new Set(earlier?.map(Number))

	return new Map(
		[...statuses].filter(([issue, status]) => !lanes.has(issue) || status.started_ms !== undefined),
	)
}

const run_board_earlier = { NO_EARLIER, is_live, own_statuses, rows_of }

export { run_board_earlier }
export type { EarlierLanes }
