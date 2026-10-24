import type { Found } from './run-board-found'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import type { ItemState } from './run-board-status'

// A done row's end after its time (joshuafolkken/kit#4772): the numbers of the Issues filed during its
// child's work, each a link and none with `#`, then the spinner while its overrun investigation runs —
// 🔍 where no spinner turns.

const { OVERRUN_MARK } = run_board_labels
const DONE_STATES: ReadonlySet<ItemState> = new Set(['merged', 'done'])
const SEPARATOR = ', '

function found_of(row: BoardRow, header: BoardHeader): Found | undefined {
	if (!DONE_STATES.has(row.state)) return undefined

	return header.found?.get(row.number)
}

function mark_of(found: Found, header: BoardHeader): string | undefined {
	if (!found.is_investigating) return undefined

	return header.spinner ?? OVERRUN_MARK
}

// Empty for a row with nothing filed and no investigation running.
function found_text(row: BoardRow, header: BoardHeader): string {
	const found = found_of(row, header)

	if (found === undefined) return ''

	const numbers = found.filed.map((reference) => header.link(reference)).join(SEPARATOR)

	return [numbers, mark_of(found, header)]
		.filter((part) => part !== undefined && part !== '')
		.join(' ')
}

// The row ends on 🔍, which the legend names.
function is_still(row: BoardRow, header: BoardHeader): boolean {
	return header.spinner === undefined && found_of(row, header)?.is_investigating === true
}

const run_board_render_found = { found_text, is_still }

export { run_board_render_found }
