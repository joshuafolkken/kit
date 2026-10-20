import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow, RowReason } from './run-board-layout'

// A queued or waiting row's condition column, and the issues its wait names after its title
// (joshuafolkken/kit#4288) — pure. The column is one width in both sections, the widest value's — a 📅
// row's `MM-DD HH:MM` — so every row's number starts in one column. A value is padded on its drawn
// width: a linked issue's escape draws nothing.

const CONDITION_WIDTH = run_board_labels.day_minute_of(0).length
const ISSUE_SEPARATOR = ', '
const FIRST = 1

// `+1` for each issue after the first, which follow the title.
function more_of(issues: ReadonlyArray<string>): string {
	return issues.length > FIRST ? `+${String(issues.length - FIRST)}` : ''
}

// How many of the wait's issues the column draws: the first, where it fits with its `+N` — a
// cross-repo `owner/repo#N` reference overruns the column, so it and the rest follow the title.
function column_count_of(issues: ReadonlyArray<string>): number {
	const [first] = issues

	if (first === undefined) return 0

	return run_board_fit.width_of(`${first}${more_of(issues)}`) <= CONDITION_WIDTH ? FIRST : 0
}

// The first issue with its `+N` where the column draws it, else blank.
function issue_value_of(issues: ReadonlyArray<string>, header: BoardHeader): string {
	const [first = ''] = issues.slice(0, column_count_of(issues))

	return first === '' ? '' : `${header.link(first)}${more_of(issues)}`
}

// The wait's issues, else how long a stage has stood, else the wait's own figure.
function value_of(reason: RowReason, header: BoardHeader): string {
	const { issues = [], since_ms } = reason

	if (issues.length > 0) return issue_value_of(issues, header)
	if (since_ms !== undefined) return run_board_labels.span_of(header.now_ms - since_ms)

	return reason.value ?? ''
}

// The column as drawn, blank where the row names no condition.
function condition_of(row: BoardRow, header: BoardHeader): string {
	const value = row.reason === undefined ? '' : value_of(row.reason, header)
	const blank = Math.max(0, CONDITION_WIDTH - run_board_fit.width_of(value))

	return `${value}${' '.repeat(blank)}`
}

// The issues the wait names that the column does not draw, which follow the title; `undefined` where
// it names none.
function rest_of(reason: RowReason | undefined): ReadonlyArray<string> | undefined {
	const issues = reason?.issues

	return issues?.slice(column_count_of(issues))
}

function linked(issues: ReadonlyArray<string>, header: BoardHeader): string | undefined {
	if (issues.length === 0) return undefined

	return issues.map((reference) => header.link(reference)).join(ISSUE_SEPARATOR)
}

// What a row waits on after its title: in a section that draws the condition column, the issues its
// wait names after the first; any other row — a 🙋 one, or a stalled one whose wait names no issue
// even there — `🔗` and every blocker still standing.
function waits_of(row: BoardRow, header: BoardHeader, is_conditioned = false): string | undefined {
	const rest = is_conditioned ? rest_of(row.reason) : undefined

	if (rest !== undefined) return linked(rest, header)

	const blockers = linked(row.waits, header)

	return blockers === undefined ? undefined : `${run_board_labels.WAITS_ICON} ${blockers}`
}

const run_board_render_condition = { CONDITION_WIDTH, condition_of, waits_of }

export { run_board_render_condition }
