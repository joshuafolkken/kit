import { run_board_fit } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import type { ItemState } from './run-board-status'
import type { LaneUsages } from './run-board-usage'
import { run_board_usage_text } from './run-board-usage-text'

// The column between a row's time and its track, one width on every row it is drawn on, so every
// track starts in one column: a running row's CPU and memory, a finished row's finish time, and
// blanks on any other row.

const { finish_of, text_of } = run_board_usage_text
const FINISHED: ReadonlySet<ItemState> = new Set(['merged', 'done'])
const BLANK = ' '

function slot_of(row: BoardRow, usages: LaneUsages, now_ms: number): string | undefined {
	if (row.state === 'running') return text_of(usages.get(row.number))
	if (FINISHED.has(row.state)) return finish_of(row.status?.ended_ms, now_ms)

	return undefined
}

// The widest any row of the frame draws, as the terminal counts it — an emoji takes two columns.
function column_width(rows: ReadonlyArray<BoardRow>, usages: LaneUsages, now_ms: number): number {
	const widths = rows.map((row) => run_board_fit.width_of(slot_of(row, usages, now_ms) ?? ''))

	return Math.max(0, ...widths)
}

// A row's column padded with blanks to the frame's width.
function cell_of(text: string | undefined, width: number): string {
	const drawn = text ?? ''

	return `${drawn}${BLANK.repeat(Math.max(0, width - run_board_fit.width_of(drawn)))}`
}

const run_board_render_slot = { cell_of, column_width, slot_of }

export { run_board_render_slot }
