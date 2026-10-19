import { run_board_fit, type PlanLine, type PlanSection } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'

// A plan section as drawn: a rule rather than a heading, and the done section that folds its oldest
// rows into one count when the pane is short.

const { STATE_ICONS, WORDS } = run_board_labels
const GAP = '  '
const INDENT = '  '
const RULE = '─'
const RULE_LEAD = `${RULE}${RULE}`
const RULE_WIDTH = 50

function rule_of(label: string): string {
	return `${RULE_LEAD} ${label} `.padEnd(RULE_WIDTH, RULE)
}

// A column's label and the terminal column its cells start at.
interface RuleColumn {
	label: string
	start: number
}

// A rule whose column labels stand over their cells: `── 🛤 lanes ── 💪 CPU ─ 🧠 MEM ───`, each label at
// its column's start where the rule before it leaves room, and one rule character after the label
// before it where it does not.
function columns_rule(label: string, columns: ReadonlyArray<RuleColumn>): string {
	let rule = `${RULE_LEAD} ${label} `

	for (const column of columns) {
		const fill = Math.max(1, column.start - run_board_fit.width_of(rule) - 1)

		rule += `${RULE.repeat(fill)} ${column.label} `
	}

	return `${rule}${RULE.repeat(Math.max(RULE_LEAD.length, RULE_WIDTH - run_board_fit.width_of(rule)))}`
}

// The column a rule labeled `label` lets its first column's label start at.
function label_room(label: string): number {
	return run_board_fit.width_of(`${RULE_LEAD} ${label} ${RULE} `)
}

function heading_lines(heading: string | undefined): Array<string> {
	return heading === undefined ? [''] : ['', rule_of(heading)]
}

function plan_section(
	heading: string | undefined,
	lines: ReadonlyArray<PlanLine>,
): Array<PlanSection> {
	if (lines.length === 0) return []

	return [{ head: heading_lines(heading), lines }]
}

// The finished rows' cut ones counted on one line, the withdrawn among them beside it.
function done_fold(withdrawn: ReadonlySet<PlanLine>): (cut: ReadonlyArray<PlanLine>) => string {
	return (cut) => {
		const gone = cut.filter((line) => withdrawn.has(line)).length
		const count = `${STATE_ICONS.merged} ${String(cut.length)} ${WORDS.more}`
		const marks = gone === 0 ? [] : [`${STATE_ICONS.withdrawn} ${String(gone)}`]

		return `${INDENT}${[count, ...marks].join(GAP)}`
	}
}

// The finished rows under their own rule, each drawn by `line_of`, folded from the oldest.
function done_section(
	rows: ReadonlyArray<BoardRow>,
	line_of: (row: BoardRow) => PlanLine,
): Array<PlanSection> {
	const lines = rows.map((row) => line_of(row))
	const withdrawn = new Set(lines.filter((_, index) => rows[index]?.state === 'withdrawn'))
	const heading = `${STATE_ICONS.merged} ${WORDS.done}`

	return plan_section(heading, lines).map((section) => ({ ...section, fold: done_fold(withdrawn) }))
}

const run_board_render_section = {
	columns_rule,
	done_section,
	heading_lines,
	label_room,
	plan_section,
}

export { run_board_render_section }
export type { RuleColumn }
