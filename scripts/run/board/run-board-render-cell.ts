import { run_board_fresh } from './run-board-fresh'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import { run_board_render_slot } from './run-board-render-slot'
import { run_board_render_tail } from './run-board-render-tail'

const { cell_of, slot_of } = run_board_render_slot

// A row's finish-time column as drawn: a settled row's finish time emphasized while it is fresh.
function slot_text(row: BoardRow, header: BoardHeader): string | undefined {
	const slot = slot_of(row, header.now_ms)

	return slot === undefined ? slot : run_board_fresh.since(slot, row.status?.ended_ms, header)
}

// A parked row has no finish time — a decision park drawn 🙋 among them.
function is_parked(row: BoardRow): boolean {
	return row.status?.state === 'parked'
}

// A row's finish-time column where the frame draws one, padded to one width so every finish time and
// what follows it start in one column. A plan row the run has not touched draws blanks in its place; a
// parked row draws none, and its reason follows its time; a row that ends on a tail draws none either,
// its tail following its time (joshuafolkken/kit#4217).
function cell_text(row: BoardRow, slot_width: number, header: BoardHeader): string | undefined {
	if (slot_width === 0 || is_parked(row) || run_board_render_tail.is_tailed(row)) return undefined
	if (row.status === undefined) return ' '.repeat(slot_width)

	return cell_of(slot_text(row, header), slot_width)
}

const run_board_render_cell = { cell_text }

export { run_board_render_cell }
