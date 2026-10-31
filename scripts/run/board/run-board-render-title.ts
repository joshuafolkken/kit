import { run_board_fit } from './run-board-fit'
import type { BoardRow } from './run-board-layout'

// A row's title and the reason it makes room for — pure. A title is cut to the title column; a row
// that says why it waits, or draws a tail, keeps its line on a narrow pane, its title giving up the
// columns the line runs over down to a floor and its reason the rest; past the floor it wraps.

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

// The row's reason as it follows the title — what a waiting row waits on there, or why a parked or
// withdrawn row ended — with `cut` columns given up at its end, which then ends on an ellipsis; at
// least the ellipsis is left.
function reason_text(row: BoardRow, cut = 0): string | undefined {
	const text = row.reason?.tail

	if (text === undefined || cut === 0) return text

	return columns_cut(text, Math.max(1, run_board_fit.width_of(text) - cut))
}

// The columns a line runs past the pane, for a row whose end it keeps; none for any other row, and none
// for a frame that is not kept within a pane.
function overrun_of(text: string, is_kept: boolean, columns: number | undefined): number {
	if (columns === undefined || !is_kept) return 0

	return Math.max(0, run_board_fit.width_of(text) - columns)
}

// How a row is fitted: whether it keeps its whole line — a row that draws a tail, a held check among
// it (joshuafolkken/kit#4052) — the columns its title cell leads its title with, a ✚ on a row the run
// filed, its head as drawn, kept on one line where the row's head is too wide to assume it fits — a
// lane row's, with its cells (joshuafolkken/kit#3769) — and the columns its section's rows give up
// together, so their titles end in one column.
interface RowFit {
	is_line_kept?: boolean
	lead?: number
	head?: (cut: RowCut) => string
	is_head_kept?: boolean
	shared?: number | undefined
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

// The columns a row's line runs past the pane at its whole title, where the row has a reason or a
// whole line to keep, or its kept head does.
function row_overrun(
	row: BoardRow,
	columns: number | undefined,
	draw: (cut: RowCut) => string,
	fit: RowFit = {},
): number {
	const line = overrun_of(
		draw(WHOLE),
		fit.is_line_kept === true || row.reason !== undefined,
		columns,
	)

	return Math.max(line, head_overrun(fit, columns))
}

// The columns `fitted` cuts the row's title to, none where it draws the row whole.
function fitted_limit(
	row: BoardRow,
	columns: number | undefined,
	draw: (cut: RowCut) => string,
	fit: RowFit = {},
): number | undefined {
	const overrun = Math.max(row_overrun(row, columns, draw, fit), fit.shared ?? 0)

	return overrun === 0 ? undefined : narrowed_limit(row, overrun, fit.lead ?? 0)
}

// A row's line as `draw` draws it: whole, or — where it or its section runs past the pane — with its
// title narrowed first and its reason cut after.
function fitted(
	row: BoardRow,
	columns: number | undefined,
	draw: (cut: RowCut) => string,
	fit: RowFit = {},
): string {
	const title_limit = fitted_limit(row, columns, draw, fit)

	if (title_limit === undefined) return draw(WHOLE)

	return reason_fitted(row, columns, title_limit, draw)
}

const run_board_render_title = {
	ELLIPSIS,
	TITLE_LIMIT,
	WHOLE,
	columns_cut,
	fitted,
	fitted_limit,
	reason_text,
	row_overrun,
	title_of,
}

export { run_board_render_title, type RowCut, type RowFit }
