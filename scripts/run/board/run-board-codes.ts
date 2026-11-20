import { run_board_label_pair } from './run-board-label-pair'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_lamps } from './run-board-lamps'
import { run_board_screen } from './run-board-screen'
import { run_board_spot } from './run-board-spot'
import type { BoardPorts } from './run-board-state'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_type_rows, type Typing } from './run-board-type-rows'

// joshuafolkken/kit#8375: while a row types on a wargames live board, every section rule's `─` runs
// launch-code characters; once the last row is typed through, each cell turns back into the rule on a
// step of its own, all within `SCATTER_STEPS` (joshuafolkken/kit#8403). The cells are written between
// redraws, like the lamps.

const CSI = '\u{1B}['
const RULE = '─'
const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
// The write step; the code changes every `CHANGE_MS`.
const CODE_MS = 50
const CHANGE_MS = 100
// The steps after the typing within which every cell is back to the rule, whatever the board's width.
const SCATTER_STEPS = 20
// The code and the rule it turns back into, in the rule's dim paint (joshuafolkken/kit#8397).
const CODE_PAINT: Paint = run_board_theme_defs.THEME_DEFS.wargames.rule

// A rule's `─` on screen.
interface RuleCell {
	row: number
	column: number
}

// What a rule cell shows at a moment: the rule or the code.
type CellLook = 'rule' | 'code'

type CodePorts = Pick<BoardPorts, 'write' | 'write_drawn'>

// What opens a section rule stays drawn as it is.
function line_cells(line: string, row: number, columns: number): Array<RuleCell> {
	const lead = run_board_label_pair.heading_lead(line)

	if (lead === undefined) return []

	return [...line.matchAll(new RegExp(RULE, 'gu'))]
		.filter((match) => match.index >= lead.length)
		.map((match) => run_board_spot.spot_at(line, match.index, row, columns))
		.map(({ row: at_row, column }) => ({ row: at_row, column }))
}

// Every section rule's `─` past its lead, on the row each line starts on.
function rule_cells(
	lines: ReadonlyArray<string>,
	starts: ReadonlyArray<number>,
	columns: number,
): Array<RuleCell> {
	return lines.flatMap((line, index) => line_cells(line, starts[index] ?? 1, columns))
}

function step_of(ms: number, step_ms = CODE_MS): number {
	return Math.floor(ms / step_ms)
}

// The moment the last cell is back to the rule — none before any row has typed — so another effect can
// end on it (joshuafolkken/kit#8376).
function locked_at(typing: Typing): number | undefined {
	const done_ms = run_board_type_rows.done_ms(typing)

	if (done_ms === undefined) return undefined

	return (step_of(done_ms) + SCATTER_STEPS) * CODE_MS
}

// The steps since the last row typed through by `at_ms`; `-1` while a row types or before any has.
function cooled_steps(typing: Typing, at_ms: number): number {
	const done_ms = run_board_type_rows.done_ms(typing)

	if (done_ms === undefined || run_board_type_rows.is_typing(typing, at_ms)) return -1

	return step_of(at_ms) - step_of(done_ms)
}

// Whether the rules run code at `at_ms`: while a row types, and until every cell is back to the rule.
function is_coding(typing: Typing, cells: ReadonlyArray<RuleCell>, at_ms: number): boolean {
	if (cells.length === 0) return false
	if (run_board_type_rows.is_typing(typing, at_ms)) return true

	return at_ms < (locked_at(typing) ?? -Infinity)
}

// A cell turns back into the rule once `cooled` passes its own step, so the cells go back scattered.
function look_of(cell: RuleCell, cooled: number): CellLook {
	return run_board_lamps.mixed([cell.row, cell.column]) % SCATTER_STEPS < cooled ? 'rule' : 'code'
}

// A code character for the cell, changing every `CHANGE_MS` — two write steps, so the code stays behind
// the typing head (joshuafolkken/kit#8397).
function code_of(cell: RuleCell, at_ms: number): string {
	const step = step_of(at_ms, CHANGE_MS)

	return CODE[run_board_lamps.mixed([cell.row, cell.column, step]) % CODE.length] ?? '-'
}

function cell_text(cell: RuleCell, look: CellLook, at_ms: number): string {
	return run_board_labels.painted(CODE_PAINT, look === 'rule' ? '-' : code_of(cell, at_ms))
}

// The cells to write at `at_ms`: every cell running code, and the rule back in each cell that ran code at
// `since_ms`, the last write — none to restore after a redraw, which drew the rules. A cell that is code
// at `at_ms` was code at `since_ms` too, so the earlier step picks both.
function code_bytes(
	typing: Typing,
	cells: ReadonlyArray<RuleCell>,
	at_ms: number,
	since_ms: number | undefined,
): string {
	const did_code = since_ms !== undefined && is_coding(typing, cells, since_ms)

	if (!did_code && !is_coding(typing, cells, at_ms)) return ''
	const cooled = cooled_steps(typing, at_ms)
	const passed = did_code ? Math.min(cooled_steps(typing, since_ms), cooled) : cooled

	return cells
		.filter((cell) => look_of(cell, passed) === 'code')
		.map(
			(cell) =>
				`${CSI}${String(cell.row)};${String(cell.column)}H${cell_text(cell, look_of(cell, cooled), at_ms)}`,
		)
		.join('')
}

// The rule cells that changed since the last write, written outside the theme's restyling, as the lamps are.
function write_codes(
	coded: { typing: Typing; cells: ReadonlyArray<RuleCell> },
	ports: CodePorts,
	at_ms: number,
	since_ms: number | undefined,
): void {
	const bytes = code_bytes(coded.typing, coded.cells, at_ms, since_ms)

	if (bytes === '') return
	const write = ports.write_drawn ?? ports.write

	write(run_board_screen.synced(bytes))
}

const run_board_codes = {
	CHANGE_MS,
	CODE,
	CODE_MS,
	CODE_PAINT,
	code_bytes,
	is_coding,
	locked_at,
	rule_cells,
	SCATTER_STEPS,
	write_codes,
}

export { run_board_codes }
export type { RuleCell }
