import type { Cell, Grid, ThemeLayout } from './run-board-theme-host-types'

// The board's section rules as a theme finds them (joshuafolkken/kit#8917): by the cells' role, never by
// the row's words. A live board's rule starts with its fold marker (`V -- throughput ---`, a folded one
// `> -- usage -- …`), the confirmed demo's frame with `-- --`; either way kit styles the rule's line
// cells `rule`, which no other row has (the processes rows' gauges are `body:dim`).

const LINE_CHARS = new Set(['-', '─'])

function is_rule_line([ch, style]: Cell): boolean {
	return style.startsWith('rule') && LINE_CHARS.has(ch)
}

// Whether row `y` of `board` is a section rule.
function is_rule_row(board: Grid, y: number): boolean {
	return (board[y] ?? []).some((cell) => is_rule_line(cell))
}

// The rows of `board` that are section rules, top to bottom; open or folded alike.
function rule_rows_of(board: Grid): Array<number> {
	return [...board.keys()].filter((y) => is_rule_row(board, y))
}

// Where rule `y`'s label starts: past its lead — the demo's `--`, a live rule's fold marker — and its icon,
// a blank after each (`label-pair.ts`); the demo's `-- -- throughput` at 6, a live `V -- throughput` at 5.
function label_x_of(board: Grid, y: number): number {
	const cells = board[y] ?? []
	const lead = cells.findIndex(([ch]) => ch === ' ')
	const icon = cells.findIndex(([ch], x) => x > lead && ch === ' ')

	return icon + 1
}

// A rule a theme retitles over a cleared area: the base's lead and icon put back as the board has them
// (the demo's `-- --`, a live `V --`) in the rule's `style`, as the demo paints its lead; the label's
// column returned for the theme's own title.
function retitled_lead(grid: Grid, board: Grid, at: { y: number; style: string }): number {
	const { y, style } = at
	const label_x = label_x_of(board, y)
	const row = grid[y]
	const lead = (board[y] ?? []).slice(0, label_x)

	if (row) for (const [x, [ch]] of lead.entries()) row[x] = [ch, style]

	return label_x
}

// The LANES section's rule: the row kit keyed for the plan's progress at the rule's end (`plan:…`) where
// it is a rule, else the last rule above the first lane; none without either. Open, folded or with no
// lane at all, it is there while the section is.
function lanes_rule_of(
	rule_rows: ReadonlyArray<number>,
	plan_row: number | undefined,
	lane_rows: ReadonlyArray<number>,
): number | undefined {
	if (plan_row !== undefined && rule_rows.includes(plan_row)) return plan_row
	const [first] = lane_rows

	return first === undefined ? undefined : rule_rows.findLast((y) => y < first)
}

// The LANES rule of a layout over `board`: the one kit laid out, else found from the rules and the lanes.
function lanes_rule_at(layout: ThemeLayout, board: Grid): number | undefined {
	return layout.lanes_rule ?? lanes_rule_of(rule_rows_of(board), undefined, layout.lane_rows)
}

const run_board_theme_rules = {
	is_rule_line,
	is_rule_row,
	label_x_of,
	lanes_rule_at,
	lanes_rule_of,
	retitled_lead,
	rule_rows_of,
}

export { run_board_theme_rules }
