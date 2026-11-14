import { run_board_layout, type BoardLayout, type BoardRow, type RowRead } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import type { EndedRoot } from './run-board-single'
import { run_board_status, type ItemStatus } from './run-board-status'

// The root checkout's single runs beside a carried run. A running one is drawn under 🏠 above the lanes
// (joshuafolkken/kit#7524), its row read off its own span's events and kept out of `active`, so the
// header counts no lane and no 🔄 for it. One a merge ended inside the run leaves 🏠 and is listed in
// `✅ done` as a lane's finished row is, in its place by its end (joshuafolkken/kit#7525).

type RootRead = Pick<LocalRead, 'root' | 'ended_roots' | 'lane_states'>

function live_of(local: RootRead, read: RowRead): Pick<BoardLayout, 'root'> {
	const { root } = local

	if (root === undefined) return {}
	const status = run_board_status.statuses_of(root.events, local.lane_states).get(root.issue)

	if (status === undefined) return {}
	const statuses = new Map([[root.issue, status]])
	const [row] = run_board_layout.local_layout_of(statuses, undefined, read).active

	return row === undefined ? {} : { root: { name: root.command, row } }
}

// A merge released the run's hold, so it ended merged.
function ended_status(run: EndedRoot): ItemStatus {
	return { state: 'merged', started_ms: run.started_ms, ended_ms: run.ended_ms }
}

// The ended runs' rows among the run's own, any row of the same issue replaced.
function active_of(
	active: ReadonlyArray<BoardRow>,
	ended: ReadonlyArray<EndedRoot>,
	read: RowRead,
): ReadonlyArray<BoardRow> {
	if (ended.length === 0) return active

	const statuses = new Map(ended.map((run) => [run.issue, ended_status(run)]))
	const rows = run_board_layout.local_layout_of(statuses, undefined, read).active
	const kept = active.filter((row) => !statuses.has(row.number))

	return [...kept, ...rows].toSorted(run_board_layout.active_order)
}

function layout_of(layout: BoardLayout, local: RootRead, read: RowRead): BoardLayout {
	return {
		...layout,
		active: active_of(layout.active, local.ended_roots ?? [], read),
		...live_of(local, read),
	}
}

const run_board_root_layout = { layout_of }

export { run_board_root_layout }
