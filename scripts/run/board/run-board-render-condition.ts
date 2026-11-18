import { run_board_estimate } from './run-board-estimate'
import { run_board_fit } from './run-board-fit'
import { run_board_fresh } from './run-board-fresh'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardRow, type RowReason } from './run-board-layout'
import { run_board_render_title } from './run-board-render-title'

// A queued, waiting or done row's condition column, and the issues its wait names after its title
// (joshuafolkken/kit#4288, #4292) — pure. The column is one width in every section, the widest value's
// — a 📅 row's or a done row's `MM-DD HH:MM`, or a longer waiting issue's (`width_for`) — so every
// row's number starts in one column. A value is
// padded on its drawn width: a linked issue's escape draws nothing.

const CONDITION_WIDTH = run_board_labels.day_minute_of(0).length
const ISSUE_SEPARATOR = ', '
const FIRST = 1

// `+1` for each issue after the first, which follow the title.
function more_of(issues: ReadonlyArray<string>): string {
	return issues.length > FIRST ? `+${String(issues.length - FIRST)}` : ''
}

// The drawn width of the wait's first issue with its `+N`; `0` where it names none.
function first_width(issues: ReadonlyArray<string> = []): number {
	const [first] = issues

	return first === undefined ? 0 : run_board_fit.width_of(`${first}${more_of(issues)}`)
}

// The column as wide as the longest first issue the rows' waits name, never narrower than the date —
// a cross-repo `kit#7691` is drawn whole there, since a cut number names no Issue
// (joshuafolkken/kit#7695).
function width_for(rows: ReadonlyArray<BoardRow>): number {
	return Math.max(CONDITION_WIDTH, ...rows.map((row) => first_width(row.reason?.issues)))
}

// How many of the wait's issues the column draws: the first, where it fits with its `+N` — one wider
// than the column follows the title with the rest.
function column_count_of(issues: ReadonlyArray<string>, width: number): number {
	if (issues.length === 0) return 0

	return first_width(issues) <= width ? FIRST : 0
}

// The first issue with its `+N` where the column draws it, else blank.
function issue_value_of(issues: ReadonlyArray<string>, header: BoardHeader, width: number): string {
	const [first = ''] = issues.slice(0, column_count_of(issues, width))

	return first === '' ? '' : `${header.link(first)}${more_of(issues)}`
}

// The text with the reason's pull request number at its end linked to it, where the text keeps the
// number whole — a cut text ends on an ellipsis and stays plain, so no escape is cut and the drawn
// width stays the plain text's (joshuafolkken/kit#7181).
function pr_linked(text: string, pr: number | undefined, header: BoardHeader): string {
	if (pr === undefined || !text.endsWith(String(pr))) return text

	return `${text.slice(0, -String(pr).length)}${header.pull_link(pr)}`
}

// The wait's issues, else how long a stage has stood, else the wait's own figure.
function value_of(reason: RowReason, header: BoardHeader, width: number): string {
	const { issues = [], since_ms } = reason

	if (issues.length > 0) return issue_value_of(issues, header, width)
	if (since_ms !== undefined) return run_board_labels.span_of(header.now_ms - since_ms)

	return pr_linked(reason.value ?? '', reason.pr, header)
}

// The row's reason after its title, `cut` columns given up as `reason_text` gives them, its pull
// request linked.
function evidence_linked(text: string, url: string, header: BoardHeader): string {
	return header.comment_link?.(text, url) ?? text
}

function reason_of(row: BoardRow, cut: number, header: BoardHeader): string {
	const text = run_board_render_title.reason_text(row, cut) ?? ''
	const url = row.reason?.evidence_url

	return url === undefined
		? pr_linked(text, row.reason?.pr, header)
		: evidence_linked(text, url, header)
}

// The reason, then `🎯 —` for a row waiting on a person or parked, whose finish nothing measures
// (joshuafolkken/kit#7920).
function tail_of(row: BoardRow, cut: number, header: BoardHeader): string {
	// A running row's finish ends its own tail (`run-board-render-tail.ts`).
	const is_held = row.state !== 'running' && run_board_estimate.is_finish_drawn(row, header)
	const parts = [reason_of(row, cut, header), is_held ? run_board_estimate.UNKNOWN : '']

	return parts.filter((part) => part !== '').join(' ')
}

// A finished row's end, `MM-DD HH:MM`, emphasized while fresh (joshuafolkken/kit#4292); blank where
// the row is not finished or recorded no end.
function ended_of(row: BoardRow, header: BoardHeader): string {
	const ended_ms = row.status?.ended_ms

	if (ended_ms === undefined || !run_board_layout.is_finished(row.state)) return ''

	return run_board_fresh.since(run_board_labels.day_minute_of(ended_ms), ended_ms, header)
}

// The column as drawn, `width` wide: what the row waits on, else when it finished, else blank.
function condition_of(row: BoardRow, header: BoardHeader, width = CONDITION_WIDTH): string {
	const reason_value = row.reason === undefined ? '' : value_of(row.reason, header, width)
	const value = reason_value === '' ? ended_of(row, header) : reason_value
	const blank = Math.max(0, width - run_board_fit.width_of(value))

	return `${value}${' '.repeat(blank)}`
}

// The issues the wait names that the column does not draw, which follow the title; `undefined` where
// it names none.
function rest_of(reason: RowReason | undefined, width: number): ReadonlyArray<string> | undefined {
	const issues = reason?.issues

	return issues?.slice(column_count_of(issues, width))
}

function linked(issues: ReadonlyArray<string>, header: BoardHeader): string | undefined {
	if (issues.length === 0) return undefined

	return issues.map((reference) => header.link(reference)).join(ISSUE_SEPARATOR)
}

// What a row waits on after its title: in a section that draws the condition column, the issues its
// wait names after the first; any other row — a 🙋 one, or a stalled one whose wait names no issue
// even there — `🔗` and every blocker still standing. `width` is the condition column's; `undefined`
// where the section draws none.
function waits_of(row: BoardRow, header: BoardHeader, width?: number): string | undefined {
	const rest = width === undefined ? undefined : rest_of(row.reason, width)

	if (rest !== undefined) return linked(rest, header)

	const blockers = linked(row.waits, header)

	return blockers === undefined ? undefined : `${run_board_labels.WAITS_ICON} ${blockers}`
}

const run_board_render_condition = { CONDITION_WIDTH, condition_of, tail_of, waits_of, width_for }

export { run_board_render_condition }
