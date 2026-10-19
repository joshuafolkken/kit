import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'

// A row's title and the reason it makes room for — pure. A title is cut to the title column; a row
// that says why it waits keeps saying it on a narrow pane, its title giving up the columns the line
// runs over down to a floor and its reason the rest, where every other row wraps.

// The columns a terminal row gives its title: a longer one is cut to an ellipsis.
const TITLE_LIMIT = 48
// The least a title is cut to where a narrow pane keeps the row's reason: enough to tell rows apart.
const TITLE_FLOOR = 8
const ELLIPSIS = '…'

// What a row gives up to stay on one line: the columns its title is cut to, and the columns cut off
// its reason's end.
interface RowCut {
	title_limit: number
	reason_cut: number
}

const WHOLE: RowCut = { title_limit: TITLE_LIMIT, reason_cut: 0 }

// A title cut to the title column, so every time after it starts in one column.
function title_of(title = '', limit = TITLE_LIMIT): string {
	return title.length > limit ? `${title.slice(0, limit - 1)}${ELLIPSIS}` : title
}

// Why a waiting row waits, after its blockers, or why a parked or withdrawn row ended; a lane's stage
// with how long the lane has stood at it.
function whole_reason(row: BoardRow, now_ms: number): string | undefined {
	const { reason } = row

	if (reason?.since_ms === undefined) return reason?.text

	return `${reason.text} ${run_board_labels.span_of(now_ms - reason.since_ms)}`
}

const GRAPHEMES = new Intl.Segmenter()

// The text cut to `columns` terminal columns — a wide character takes two — ending on an ellipsis.
function columns_cut(text: string, columns: number): string {
	let kept = ''

	for (const { segment } of GRAPHEMES.segment(text)) {
		if (run_board_fit.width_of(`${kept}${segment}${ELLIPSIS}`) > columns) break
		kept += segment
	}

	return `${kept}${ELLIPSIS}`
}

// The row's reason with `cut` columns given up at its end, which then ends on an ellipsis; at least
// the ellipsis is left.
function reason_text(row: BoardRow, now_ms: number, cut = 0): string | undefined {
	const text = whole_reason(row, now_ms)

	if (text === undefined || cut === 0) return text

	return columns_cut(text, Math.max(1, run_board_fit.width_of(text) - cut))
}

// The columns a line runs past the pane, for a row whose end it keeps; none for any other row, and none
// for a frame that is not kept within a pane.
function overrun_of(text: string, is_kept: boolean, columns: number | undefined): number {
	if (columns === undefined || !is_kept) return 0

	return Math.max(0, run_board_fit.width_of(text) - columns)
}

// How a row is fitted: whether it keeps a held check, the columns its title cell leads its title
// with, a ✚ on a row the run filed, and its head as drawn, kept on one line where the row's head is
// too wide to assume it fits — a lane row's, with its cells (joshuafolkken/kit#3769).
interface RowFit {
	is_held?: boolean
	lead?: number
	head?: (cut: RowCut) => string
	is_head_kept?: boolean
}

// The columns a row's head runs past the pane at its whole title; none where it is not kept.
function head_overrun(fit: RowFit, columns: number | undefined): number {
	if (fit.head === undefined || fit.is_head_kept !== true) return 0

	return overrun_of(fit.head(WHOLE), true, columns)
}

// The columns the row's title cell takes as drawn: a waiting row's title is not padded, every other
// row's is padded to the title column.
function drawn_width(row: BoardRow, lead: number): number {
	const title = (row.title?.length ?? 0) + lead

	return row.state === 'waiting' ? Math.min(TITLE_LIMIT, title) : TITLE_LIMIT
}

// The row's title once it has given up `overrun` columns, never under the floor.
function narrowed_limit(row: BoardRow, overrun: number, lead: number): number {
	return Math.max(TITLE_FLOOR, drawn_width(row, lead) - overrun)
}

// A row's line at a narrowed title with its whole reason, or with the reason's end cut by the columns
// that line still runs past the pane.
function reason_fitted(
	row: BoardRow,
	columns: number | undefined,
	title_limit: number,
	draw: (cut: RowCut) => string,
): string {
	const text = draw({ title_limit, reason_cut: 0 })
	const reason_cut = overrun_of(text, row.reason !== undefined, columns)

	return reason_cut === 0 ? text : draw({ title_limit, reason_cut })
}

// A row's line as `draw` draws it: whole, or — where that line would run past the pane and the row has
// a reason, or a held check (joshuafolkken/kit#4052), to keep, or where its kept head would — with its
// title narrowed first and its reason cut after.
function fitted(
	row: BoardRow,
	columns: number | undefined,
	draw: (cut: RowCut) => string,
	fit: RowFit = {},
): string {
	const text = draw(WHOLE)
	const line = overrun_of(text, fit.is_held === true || row.reason !== undefined, columns)
	const overrun = Math.max(line, head_overrun(fit, columns))
	const limit = narrowed_limit(row, overrun, fit.lead ?? 0)

	return overrun === 0 ? text : reason_fitted(row, columns, limit, draw)
}

const run_board_render_title = { ELLIPSIS, TITLE_LIMIT, WHOLE, fitted, reason_text, title_of }

export { run_board_render_title, type RowCut }
