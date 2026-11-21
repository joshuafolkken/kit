import { run_board_fit, type PlanLine, type PlanSection, type SectionKey } from './run-board-fit'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'

// A plan section as drawn: a rule rather than a heading, and the done section that folds its oldest
// rows into one count when the pane is short.

const { STATE_ICONS, WORDS } = run_board_labels
const { pair } = run_board_label_pair
const GAP = '  '
// The column every section's row starts at, under a rule whose icon stands in the second column, so the
// row's icon stands clear of it (joshuafolkken/kit#4292, joshuafolkken/kit#8257); a lane row leads with
// its progress column in the blanks before it.
const { ROW_INDENT } = run_board_fit
const RULE = '─'
const RULE_LEAD = `${RULE}${RULE}`
const TRAILING_RULE = new RegExp(`${RULE}+$`, 'u')
const RULE_WIDTH = 50
const OPEN_MARK = '▾'
const FOLDED_MARK = '▸'

// A heading run on as a rule to `RULE_WIDTH` characters, a label's zero-width marks not counted.
function rule_to_width(heading: string): string {
	const marks = heading.length - run_board_label_pair.bare(heading).length

	return heading.padEnd(RULE_WIDTH + marks, RULE)
}

function rule_of(label: string): string {
	return rule_to_width(`${RULE_LEAD} ${label} `)
}

// A column's label and the terminal column its cells start at.
interface RuleColumn {
	label: string
	start: number
}

// The characters before a column label, `room` columns short of its start.
type ColumnFill = (room: number) => string

// A rule and a blank to the label's start, at least one rule character where the rule has reached it.
function forced_fill(room: number): string {
	return `${RULE.repeat(Math.max(1, room - 1))} `
}

// A rule and a blank to the label's start, blanks alone where a rule and its blank do not fit
// (`/H ACTIVE`, joshuafolkken/kit#8280).
function tight_fill(room: number): string {
	return room > 1 ? `${RULE.repeat(room - 1)} ` : ' '.repeat(Math.max(0, room))
}

function rule_with(label: string, columns: ReadonlyArray<RuleColumn>, fill: ColumnFill): string {
	let rule = `${RULE_LEAD} ${label} `

	for (const column of columns) {
		rule += `${fill(column.start - run_board_fit.width_of(rule))}${column.label} `
	}

	return `${rule}${RULE.repeat(Math.max(RULE_LEAD.length, RULE_WIDTH - run_board_fit.width_of(rule)))}`
}

// A rule whose column labels stand over their cells: `── 🧵 lanes ── 💪 CPU ─ 🧠 MEM ───`, each label at
// its column's start where the rule before it leaves room, and one rule character after the label
// before it where it does not.
function columns_rule(label: string, columns: ReadonlyArray<RuleColumn>): string {
	return rule_with(label, columns, forced_fill)
}

// `columns_rule` with no rule forced between labels: a label the rule has reached runs on after one
// blank, so labels a column apart keep their columns (the throughput rule, joshuafolkken/kit#8280).
function tight_columns_rule(label: string, columns: ReadonlyArray<RuleColumn>): string {
	return rule_with(label, columns, tight_fill)
}

function heading_lines(heading: string | undefined): Array<string> {
	return heading === undefined ? [''] : ['', rule_of(heading)]
}

// A section drawn even with no lines, its head saying `0` (joshuafolkken/kit#7281).
function kept_section(heading: string | undefined, lines: ReadonlyArray<PlanLine>): PlanSection {
	return { head: heading_lines(heading), lines, label: heading }
}

function plan_section(
	heading: string | undefined,
	lines: ReadonlyArray<PlanLine>,
): Array<PlanSection> {
	if (lines.length === 0) return []

	return [kept_section(heading, lines)]
}

// The issue rows among a section's lines — an epic's own line and an empty seat's are none.
function row_count(lines: ReadonlyArray<PlanLine>): number {
	return lines.filter((line) => line.row !== undefined && line.is_seat !== true).length
}

// A label saying how many its section holds, `tally` after the count: `⏳ queued 10 (🔺 2)`.
function counted(label: string, count: number, tally = ''): string {
	return `${label} ${String(count)}${tally}`
}

function counted_head(section: PlanSection): Array<string> {
	const { label, lines, tally } = section

	return heading_lines(label === undefined ? undefined : counted(label, row_count(lines), tally))
}

// The sections a person folds with the key named `key`, each rule saying how many rows it holds,
// `tally` (`run_board_priority.tally_of`) after the count, folded or not (joshuafolkken/kit#8511), and
// `tail` at the rule's right end (joshuafolkken/kit#8512).
function keyed(
	key: SectionKey,
	sections: ReadonlyArray<PlanSection>,
	tally?: string,
	tail?: string,
): Array<PlanSection> {
	return sections.map((section) => {
		const tallied = { ...section, key, tally, tail }

		return { ...tallied, head: counted_head(tallied) }
	})
}

// A rule with `tail` right-aligned at its end: the rule gives up the tail's columns and one blank,
// keeping at least `RULE_LEAD` before it (joshuafolkken/kit#8474).
function tailed(rule: string, tail: string | undefined): string {
	if (tail === undefined) return rule

	const body = rule.replace(TRAILING_RULE, '')
	const room = rule.length - body.length - run_board_fit.width_of(tail) - 1

	return `${body}${RULE.repeat(Math.max(RULE_LEAD.length, room))} ${tail}`
}

// A head whose rule runs on to `width`, the column the lane rows' titles end in
// (joshuafolkken/kit#5520), `tail` at its end; a head drawn under a blank line alone stays as it is.
function widened(head: ReadonlyArray<string>, width: number, tail?: string): Array<string> {
	const rule = head.at(-1) ?? ''

	if (rule === '') return [...head]

	const fill = RULE.repeat(Math.max(0, width - run_board_fit.width_of(rule)))

	return [...head.slice(0, -1), tailed(`${rule}${fill}`, tail)]
}

// Where an open head draws the rule character its ▾ gives up: in the first run of rules longer than
// the one `columns_rule` forces between labels (`tight_columns_rule` forces none), so a column label a
// lone rule pushed past its start comes back to it and every later label stands where it did
// (joshuafolkken/kit#8257).
function given_up_at(rest: string): number {
	const run = rest.indexOf(RULE_LEAD)

	return run === -1 ? Math.max(0, rest.indexOf(RULE)) : run
}

// An unfolded section's rule led by ▾ in place of its first rule characters, the one it gives up drawn
// in its rule after the label (`given_up_at`), so what follows the label — its count, every column
// label — still stands where it did; a section drawn under a blank line alone gets a rule of its own.
function open_head(head: ReadonlyArray<string>, label: string): Array<string> {
	const rule = head.at(-1) ?? ''
	const lead = `${RULE_LEAD} ${label} `

	if (!rule.startsWith(lead)) return ['', rule_to_width(`${OPEN_MARK} ${label} `)]

	const rest = rule.slice(lead.length)
	const at = given_up_at(rest)

	return [
		...head.slice(0, -1),
		`${OPEN_MARK} ${label} ${rest.slice(0, at)}${RULE}${rest.slice(at)}`,
	]
}

// The rule of a section no key folds, on a live frame: led by one rule character so its icon stands in
// the second column as the ▾ heads' do (joshuafolkken/kit#8257), its width the same.
function lone_head(head: ReadonlyArray<string>, label: string): Array<string> {
	const rule = head.at(-1) ?? ''
	const lead = `${RULE_LEAD} ${label} `

	if (!rule.startsWith(lead)) return [...head]

	return [...head.slice(0, -1), `${RULE} ${label} ${RULE}${rule.slice(lead.length)}`]
}

// A folded section's one line: `▸ ⏳ queued ── 3 ───`, ending on a rule however long its summary.
function folded_head(label: string, summary: string): Array<string> {
	return ['', rule_to_width(`${FOLDED_MARK} ${label} ${RULE_LEAD} ${summary} ${RULE_LEAD}`)]
}

// A section's cut rows counted on one line led by its rows' icon, `marks` beside the count:
// `✅ 13 more`, `💬 15 more` (joshuafolkken/kit#8257).
function more_line(icon: string, count: number, marks: ReadonlyArray<string> = []): string {
	const counted_text = [icon, String(count), WORDS.more].join(' ')

	return `${ROW_INDENT}${[counted_text, ...marks].join(GAP)}`
}

// The finished rows' cut ones counted on one line, the withdrawn among them beside it.
function done_fold(withdrawn: ReadonlySet<PlanLine>): (cut: ReadonlyArray<PlanLine>) => string {
	return (cut) => {
		const gone = cut.filter((line) => withdrawn.has(line)).length
		const marks = gone === 0 ? [] : [`${STATE_ICONS.withdrawn} ${String(gone)}`]

		return more_line(STATE_ICONS.merged, cut.length, marks)
	}
}

// The finished rows under their own rule, each drawn by `line_of`, folded from the oldest.
function done_section(
	rows: ReadonlyArray<BoardRow>,
	line_of: (row: BoardRow) => PlanLine,
): Array<PlanSection> {
	const lines = rows.map((row) => line_of(row))
	const withdrawn = new Set(lines.filter((_, index) => rows[index]?.state === 'withdrawn'))
	const heading = pair(STATE_ICONS.merged, WORDS.done)

	return keyed('done', plan_section(heading, lines)).map((section) => ({
		...section,
		fold: done_fold(withdrawn),
	}))
}

const run_board_render_section = {
	ROW_INDENT,
	columns_rule,
	counted,
	done_section,
	folded_head,
	heading_lines,
	kept_section,
	keyed,
	lone_head,
	more_line,
	open_head,
	plan_section,
	row_count,
	tailed,
	tight_columns_rule,
	widened,
}

export { run_board_render_section }
export type { RuleColumn }
