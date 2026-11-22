import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#8457: the progress tallies at the lanes rule's end (joshuafolkken/kit#8514) keyed from
// their first figure the plan knows where the board types rows, so the frame the live plan lands on types
// the faint figures over the saved ones (`run-board-type-rows.ts`) as it types the faint rows. The line is never new otherwise: its key is
// always known (`run-board-row-sections.ts`).

const PLAN_ID = 'progress'

interface PartsHeader {
	is_keyed?: boolean | undefined
}

// The progress line's key where the board types rows; none elsewhere.
function plan_key(header: PartsHeader): string | undefined {
	return header.is_keyed === true ? run_board_row_key.key_of('plan', PLAN_ID) : undefined
}

// The progress line's figures led by its key where the board types rows.
function keyed_progress(header: PartsHeader, text: string): string {
	const section = header.is_keyed === true ? 'plan' : undefined

	return run_board_row_key.keyed(section, PLAN_ID, text)
}

const run_board_header_parts = { keyed_progress, plan_key }

export { run_board_header_parts }
