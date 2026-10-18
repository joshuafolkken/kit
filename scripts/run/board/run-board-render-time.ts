import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'

// A row's time column on `run:board`: how long it has run, and how wide the column is drawn.

const { span_of } = run_board_labels

// A running row runs until now; a settled one until its recorded end. A child settled from the open
// listing has none, so it draws no time rather than one that keeps counting.
function end_of(row: BoardRow, now_ms: number): number | undefined {
	return row.state === 'running' ? now_ms : row.status?.ended_ms
}

// How long a row has run: a running one until now, a settled one its whole span.
function elapsed_ms(row: BoardRow, now_ms: number): number | undefined {
	const started = row.status?.started_ms
	const ended = end_of(row, now_ms)

	if (started === undefined || ended === undefined) return undefined

	return ended - started
}

function time_of(row: BoardRow, now_ms: number): string | undefined {
	const elapsed = elapsed_ms(row, now_ms)

	return elapsed === undefined ? undefined : span_of(elapsed)
}

// The time column's width: the widest time any active row draws in this frame.
function time_width(header: BoardHeader): number {
	const times = (header.layout?.active ?? []).map((row) => time_of(row, header.now_ms) ?? '')

	return Math.max(0, ...times.map((time) => time.length))
}

const run_board_render_time = {
	time_of,
	time_width,
}

export { run_board_render_time }
