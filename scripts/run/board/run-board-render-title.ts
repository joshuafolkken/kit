import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'

// A row's title and the reason it makes room for — pure. A title is cut to the title column; a row
// that says why it waits keeps saying it on a narrow pane, its title giving up the columns the line
// runs over, where every other row wraps.

// The columns a terminal row gives its title: a longer one is cut to an ellipsis.
const TITLE_LIMIT = 48
// The least a title is cut to where a narrow pane keeps the row's reason: enough to tell rows apart.
const TITLE_FLOOR = 8
const ELLIPSIS = '…'

// A title cut to the title column, so every time after it starts in one column.
function title_of(title = '', limit = TITLE_LIMIT): string {
	return title.length > limit ? `${title.slice(0, limit - 1)}${ELLIPSIS}` : title
}

// Why a waiting row waits, after its blockers, or why a parked or withdrawn row ended; a lane's stage
// with how long the lane has stood at it.
function reason_text(row: BoardRow, now_ms: number): string | undefined {
	const { reason } = row

	if (reason?.since_ms === undefined) return reason?.text

	return `${reason.text} ${run_board_labels.span_of(now_ms - reason.since_ms)}`
}

// The columns a line runs past the pane, for a row whose end it keeps; none for any other row, and none
// for a frame that is not kept within a pane.
function overrun_of(text: string, is_kept: boolean, columns: number | undefined): number {
	if (columns === undefined || !is_kept) return 0

	return Math.max(0, run_board_fit.width_of(text) - columns)
}

// The columns the row's title takes as drawn: a waiting row's title is not padded, every other row's
// is padded to the title column.
function drawn_width(row: BoardRow): number {
	return row.state === 'waiting' ? Math.min(TITLE_LIMIT, row.title?.length ?? 0) : TITLE_LIMIT
}

// The row's title once it has given up `overrun` columns, never under the floor.
function narrowed_limit(row: BoardRow, overrun: number): number {
	return Math.max(TITLE_FLOOR, drawn_width(row) - overrun)
}

// A row's line as `draw` draws it at a title limit: at the title column's, or at a narrower one where
// that line would run past the pane and the row has a reason, or a held check (joshuafolkken/kit#4052),
// to keep.
function fitted(
	row: BoardRow,
	columns: number | undefined,
	draw: (title_limit: number) => string,
	is_held = false,
): string {
	const text = draw(TITLE_LIMIT)
	const overrun = overrun_of(text, is_held || row.reason !== undefined, columns)

	return overrun === 0 ? text : draw(narrowed_limit(row, overrun))
}

const run_board_render_title = { ELLIPSIS, TITLE_LIMIT, fitted, reason_text, title_of }

export { run_board_render_title }
