import { run_board_layout, type BoardLayout, type BoardRow, type RowRead } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import type { EndedRoot, RootRun } from './run-board-single'
import { run_board_status, type ItemStatus } from './run-board-status'

// The root checkout's single runs beside a carried run. A running one is drawn under 🏠 above the lanes
// (joshuafolkken/kit#7524), its row read off its own span's events and kept out of `active`, so the
// header counts no lane and no 🔄 for it. One a merge ended inside the run leaves 🏠 and is listed in
// `✅ done` as a lane's finished row is, in its place by its end (joshuafolkken/kit#7525). A `halfrun` or
// `prrun` a stop ended keeps its row, stopped at its stop: its next step is still to come
// (joshuafolkken/kit#7710). Its row is built from the hold, not the events, which still read it running.

type RootRead = Pick<LocalRead, 'root' | 'ended_roots' | 'lane_states' | 'stopped_single'>

function row_of(issue: number, status: ItemStatus, read: RowRead): BoardRow | undefined {
	const [row] = run_board_layout.local_layout_of(new Map([[issue, status]]), { read }).active

	return row
}

// A merge released the run's hold, so it ended merged; a stop kept it, so it stands stopped.
type EndState = Extract<ItemStatus['state'], 'merged' | 'stopped'>

function ended_status(run: EndedRoot, state: EndState): ItemStatus {
	return { state, started_ms: run.started_ms, ended_ms: run.ended_ms }
}

function live_row(root: RootRun, local: RootRead, read: RowRead): BoardRow | undefined {
	if (root.stopped !== undefined) {
		return row_of(root.issue, ended_status(root.stopped, 'stopped'), read)
	}

	const status = run_board_status.statuses_of(root.events, local.lane_states).get(root.issue)

	return status === undefined ? undefined : row_of(root.issue, status, read)
}

function live_of(local: RootRead, read: RowRead): Pick<BoardLayout, 'root'> {
	const { root } = local

	if (root === undefined) return {}
	const row = live_row(root, local, read)

	return row === undefined ? {} : { root: { name: root.command, row } }
}

// The ended runs' rows among the run's own, any row of the same issue replaced.
function active_of(
	active: ReadonlyArray<BoardRow>,
	ended: ReadonlyArray<EndedRoot>,
	state: EndState,
	read: RowRead,
): ReadonlyArray<BoardRow> {
	if (ended.length === 0) return active

	const statuses = new Map(ended.map((run) => [run.issue, ended_status(run, state)]))
	const rows = run_board_layout.local_layout_of(statuses, { read }).active
	const kept = active.filter((row) => !statuses.has(row.number))

	return [...kept, ...rows].toSorted(run_board_layout.active_order)
}

// The board's own single run, where a stop ended it, replaces the row its events read.
function layout_of(layout: BoardLayout, local: RootRead, read: RowRead): BoardLayout {
	const merged = active_of(layout.active, local.ended_roots ?? [], 'merged', read)
	const own = local.stopped_single === undefined ? [] : [local.stopped_single]

	return {
		...layout,
		active: active_of(merged, own, 'stopped', read),
		...live_of(local, read),
	}
}

const run_board_root_layout = { layout_of }

export { run_board_root_layout }
