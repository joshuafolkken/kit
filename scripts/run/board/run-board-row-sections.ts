import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import { run_board_render_notes } from './run-board-render-notes'
import { run_board_row_key, type KeySection } from './run-board-row-key'
import { run_board_seat } from './run-board-seat'

// joshuafolkken/kit#8003: the issue rows of each keyed section, as the frame draws them
// (`run-board-render.ts`), and every one of their keys — drawn or not, so a row a fold or the pane's fit
// hid is not new when it shows again.

// The done section's rows: the run's own rows that finished.
function done_rows(layout: BoardLayout): Array<BoardRow> {
	return layout.active.filter((row) => run_board_layout.is_finished(row.state))
}

function sections_of(layout: BoardLayout): Array<[KeySection, ReadonlyArray<BoardRow>]> {
	return [
		['lanes', run_board_layout.lanes_drawn(layout)],
		['decision', run_board_layout.people_of(layout)],
		['queued', run_board_layout.queued_rows(layout)],
		['waiting', layout.unreached],
		['done', done_rows(layout)],
	]
}

// The key of every row the layout puts in a keyed section; none before a layout is read.
function keys_of(layout: BoardLayout | undefined): Set<string> {
	if (layout === undefined) return new Set()

	return new Set(
		sections_of(layout).flatMap(([section, rows]) =>
			rows.map((row) => run_board_row_key.key_of(section, row.number)),
		),
	)
}

// joshuafolkken/kit#8115: the key of every queued epic's 📁 line, folded or not.
function epic_keys_of(layout: BoardLayout | undefined): Array<string> {
	if (layout === undefined) return []

	return layout.queued
		.filter((entry) => entry.kind === 'epic')
		.map((entry) => run_board_row_key.key_of('epic', entry.epic))
}

// joshuafolkken/kit#8116: the key of every empty seat's 💺 line, by its uncut reason.
function seat_keys_of(header: BoardHeader): Array<string> {
	return run_board_seat.reasons_of(header).map((reason) => run_board_row_key.key_of('seat', reason))
}

// joshuafolkken/kit#8117: the key of every note the frame was drawn from, past the section's limit or
// the pane's fit or not.
function note_keys_of(notes: ReadonlyArray<BoardNote>): Array<string> {
	return notes.map((note) => run_board_row_key.key_of('note', run_board_render_notes.id_of(note)))
}

// Every key the board knows this frame — its rows', its epics', its seats', its notes' and the header's
// now line's — so a line is typed only when its key is new. A keyed line a later Issue adds puts its keys
// here.
function known_of(header: BoardHeader, notes: ReadonlyArray<BoardNote>): Set<string> {
	const known = keys_of(header.layout)
	const now_key = run_board_header.now_key(header)
	const keys = [...epic_keys_of(header.layout), ...seat_keys_of(header), ...note_keys_of(notes)]

	for (const key of keys) known.add(key)
	if (now_key !== undefined) known.add(now_key)

	return known
}

const run_board_row_sections = { done_rows, keys_of, known_of }

export { run_board_row_sections }
