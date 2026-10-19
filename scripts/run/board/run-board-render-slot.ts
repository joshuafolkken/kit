import { run_board_fit } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import type { ItemState } from './run-board-status'
import { run_board_usage_text } from './run-board-usage-text'

// The column between a row's time and its tail, one width on every row it is drawn on, so every
// tail starts in one column: a finished row's finish time, and blanks on any other row. A running
// row's CPU and memory are its lane cells, after its number (`run-board-render-lanes.ts`).

const { finish_of } = run_board_usage_text
const FINISHED: ReadonlySet<ItemState> = new Set(['merged', 'done', 'withdrawn'])
const BLANK = ' '

function slot_of(row: BoardRow, now_ms: number): string | undefined {
	if (FINISHED.has(row.state)) return finish_of(row.status?.ended_ms, now_ms)

	return undefined
}

// The widest any row of the frame draws, as the terminal counts it — an emoji takes two columns.
function column_width(rows: ReadonlyArray<BoardRow>, now_ms: number): number {
	const widths = rows.map((row) => run_board_fit.width_of(slot_of(row, now_ms) ?? ''))

	return Math.max(0, ...widths)
}

// A row's column padded with blanks to the frame's width.
function cell_of(text: string | undefined, width: number): string {
	const drawn = text ?? ''

	return `${drawn}${BLANK.repeat(Math.max(0, width - run_board_fit.width_of(drawn)))}`
}

const run_board_render_slot = { cell_of, column_width, slot_of }

export { run_board_render_slot }
