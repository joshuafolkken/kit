import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import { run_board_row_key, type KeySection } from './run-board-row-key'

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

const run_board_row_sections = { done_rows, keys_of }

export { run_board_row_sections }
