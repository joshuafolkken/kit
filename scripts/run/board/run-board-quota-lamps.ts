import { run_board_lamps } from './run-board-lamps'

// Where the `⛽ usage` section carries the WOPR lamp panel on (joshuafolkken/kit#8277): the blank line
// above its rule and its first two provider rows each start a panel, which `run-board-fold.ts` moves out
// to the throughput rows' start and runs on to their rule's end. GitHub's row and the rule carry none.

const { PANEL_ROWS, start_of } = run_board_lamps
const PROVIDER_ROWS = [PANEL_ROWS.first_usage, PANEL_ROWS.second_usage]

// The blank line above the rule, starting the panel's row under the throughput rows where the frame
// `has_lamps`.
function gap_line(has_lamps: boolean): string {
	return has_lamps ? ` ${start_of(PANEL_ROWS.gap)}` : ''
}

// The provider rows, the first two each ending on where its panel starts where the frame `has_lamps`.
function provider_rows(rows: ReadonlyArray<string>, has_lamps: boolean): Array<string> {
	return rows.map((row, index) => {
		const panel_row = PROVIDER_ROWS[index]

		return has_lamps && panel_row !== undefined ? `${row} ${start_of(panel_row)}` : row
	})
}

const run_board_quota_lamps = { gap_line, provider_rows }

export { run_board_quota_lamps }
