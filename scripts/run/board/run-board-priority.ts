import type { BoardPriority } from './run-board-kind'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'

// A row's priority (joshuafolkken/kit#4383), drawn between its number and its kind, and tallied
// beside the queued and waiting headings' counts (joshuafolkken/kit#8511). A normal row draws
// `KIND_BLANK` in the column, so every title still starts in one column.

const { KIND_BLANK } = run_board_labels

const PRIORITY_ICONS: Readonly<Record<BoardPriority, string>> = {
	critical: '🚨',
	high: '🔺',
}
const ORDER: ReadonlyArray<BoardPriority> = ['critical', 'high']

function cell_of(row: BoardRow): string {
	return row.priority === undefined ? KIND_BLANK : PRIORITY_ICONS[row.priority]
}

function part_of(rows: ReadonlyArray<BoardRow>, priority: BoardPriority): string | undefined {
	const count = rows.filter((row) => row.priority === priority).length

	return count === 0 ? undefined : `${PRIORITY_ICONS[priority]} ${String(count)}`
}

// ` (🚨 1 🔺 2)` after a heading's count of `rows`, naming only the priorities present; nothing when
// none is.
function tally_of(rows: ReadonlyArray<BoardRow>): string {
	const parts = ORDER.map((priority) => part_of(rows, priority)).filter(
		(part) => part !== undefined,
	)

	return parts.length === 0 ? '' : ` (${parts.join(' ')})`
}

const run_board_priority = { cell_of, tally_of }

export { run_board_priority }
