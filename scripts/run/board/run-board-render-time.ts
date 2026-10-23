import { run_board_earlier } from './run-board-earlier'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import { run_board_lane_time } from './run-board-lane-time'
import { run_board_layout, type BoardRow } from './run-board-layout'
import type { ItemStatus } from './run-board-status'

// A row's time column on `run:board`: how long it has run, and how wide the column is drawn.

const { span_of } = run_board_labels

// A running row — an earlier run's lane too — runs until now; a settled one until its recorded end. A
// child settled from the open listing has none, so it draws no time rather than one that keeps counting.
function end_of(row: BoardRow, now_ms: number): number | undefined {
	return run_board_earlier.is_live(row) ? now_ms : row.status?.ended_ms
}

// The time the event that settled the row recorded (joshuafolkken/kit#4481): a settled row draws it
// rather than counting again, so it keeps its time when its launch lies outside the run's span.
function recorded_ms(row: BoardRow): number | undefined {
	return run_board_earlier.is_live(row) ? undefined : row.status?.elapsed_ms
}

// How long a row has run on a lane, up to its end. A row whose launch rolled off the stream has no
// span, so it runs from its lane record's launch.
function counted_ms(status: ItemStatus | undefined, ended: number | undefined): number | undefined {
	if (ended === undefined || status?.started_ms === undefined) return undefined

	return run_board_lane_time.elapsed_of(status.spans ?? [], status.started_ms, ended)
}

// How long a row has run: a running one until now, a settled one until its end.
function elapsed_ms(row: BoardRow, now_ms: number): number | undefined {
	return recorded_ms(row) ?? counted_ms(row.status, end_of(row, now_ms))
}

function time_of(row: BoardRow, now_ms: number): string | undefined {
	const elapsed = elapsed_ms(row, now_ms)

	return elapsed === undefined ? undefined : span_of(elapsed)
}

// The time column's width: the widest time any active row or earlier run's lane draws in this frame.
function time_width(header: BoardHeader): number {
	const rows = run_board_layout.lane_rows(header.layout ?? run_board_layout.EMPTY_LAYOUT, [])
	const times = rows.map((row) => time_of(row, header.now_ms) ?? '')

	return Math.max(0, ...times.map((time) => time.length))
}

const run_board_render_time = {
	time_of,
	time_width,
}

export { run_board_render_time }
