import { run_board_earlier } from './run-board-earlier'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import { run_board_lane_time, type LaneTime } from './run-board-lane-time'
import { run_board_layout, type BoardRow } from './run-board-layout'
import type { ItemStatus } from './run-board-status'

// A row's time column on `run:board`: how long it has run, and how wide the column is drawn.

const { span_of } = run_board_labels

// A running row — an earlier run's lane too — runs until now; a settled one until its recorded end. A
// child settled from the open listing has none, so it draws no time rather than one that keeps counting.
function end_of(row: BoardRow, now_ms: number): number | undefined {
	return run_board_earlier.is_live(row) ? now_ms : row.status?.ended_ms
}

// How long a row has run on a lane up to its end, net of the host's stops. A row whose launch rolled
// off the stream has no span, so it runs from its lane record's launch.
function counted(status: ItemStatus | undefined, ended: number | undefined): LaneTime | undefined {
	if (ended === undefined || status?.started_ms === undefined) return undefined

	return run_board_lane_time.elapsed_of(status.spans ?? [], status.started_ms, ended, status.gaps)
}

// The stretch a recorded time reaches back from the row's end, for a row whose launch lies outside the
// run's span and left it no spans.
function reached_back(status: ItemStatus, recorded_ms: number): LaneTime | undefined {
	const { ended_ms, gaps } = status

	if (ended_ms === undefined) return undefined

	return run_board_lane_time.elapsed_of([], ended_ms - recorded_ms, ended_ms, gaps)
}

// An ending written before joshuafolkken/kit#7866 recorded its time with the host's stops in it: they
// are counted again over its spans, as the running row counted them, and taken out.
function legacy(status: ItemStatus, recorded_ms: number): LaneTime {
	const again = counted(status, status.ended_ms) ?? reached_back(status, recorded_ms)
	const excluded_ms = again?.excluded_ms ?? 0

	return { elapsed_ms: Math.max(0, recorded_ms - excluded_ms), excluded_ms }
}

// The time the event that settled the row recorded (joshuafolkken/kit#4481): a settled row draws it
// rather than counting again, so it keeps its time when its launch lies outside the run's span.
function recorded(row: BoardRow): LaneTime | undefined {
	const status = run_board_earlier.is_live(row) ? undefined : row.status

	if (status?.elapsed_ms === undefined) return undefined

	const { elapsed_ms, excluded_ms } = status

	return excluded_ms === undefined ? legacy(status, elapsed_ms) : { elapsed_ms, excluded_ms }
}

// How long a row has run: a running one until now, a settled one until its end.
function lane_time_of(row: BoardRow, now_ms: number): LaneTime | undefined {
	return recorded(row) ?? counted(row.status, end_of(row, now_ms))
}

// The net time alone, for a column of a fixed width — a lane row's (`run-board-render-lead.ts`).
function net_of(row: BoardRow, now_ms: number): string | undefined {
	const time = lane_time_of(row, now_ms)

	return time === undefined ? undefined : span_of(time.elapsed_ms)
}

// The net time, with the host's stops it left out beside it where there were any:
// `41′10″ (+2′30″)` (joshuafolkken/kit#7866).
function time_of(row: BoardRow, now_ms: number): string | undefined {
	const time = lane_time_of(row, now_ms)

	if (time === undefined) return undefined

	const net = span_of(time.elapsed_ms)

	return time.excluded_ms > 0 ? `${net} (+${span_of(time.excluded_ms)})` : net
}

// The time column's width: the widest time any active row or earlier run's lane draws in this frame.
function time_width(header: BoardHeader): number {
	const rows = run_board_layout.lane_rows(header.layout ?? run_board_layout.EMPTY_LAYOUT, [])
	const times = rows.map((row) => time_of(row, header.now_ms) ?? '')

	return Math.max(0, ...times.map((time) => time.length))
}

const run_board_render_time = {
	net_of,
	time_of,
	time_width,
}

export { run_board_render_time }
