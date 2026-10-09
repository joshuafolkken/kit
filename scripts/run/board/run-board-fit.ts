import { stripVTControlCharacters } from 'node:util'
import string_width from 'string-width'
import { run_board_labels } from './run-board-labels'

// A live `run:board` frame kept within the terminal (joshuafolkken/kit#3486). A frame taller than the
// pane scrolls the alternate screen as it is written, and the header — the lines that say whether the
// run moves and how far it is — is what scrolls off. So the plan gives way instead: its rows are cut
// from the end and one `more N` line counts them; the header, the findings and the legend stay. A line
// wider than the pane wraps, so every line is counted by the rows it takes on screen, not as one.

const { WORDS } = run_board_labels
const INDENT = '  '

interface TerminalSize {
	rows: number
	columns: number
}

// One line of the plan, and how many issue rows it draws — a rule, a blank or an epic's own line none.
interface PlanLine {
	text: string
	rows: number
}

// A frame in its three parts: the plan between what stands above it and what stands below.
interface FrameParts {
	above: ReadonlyArray<string>
	plan: ReadonlyArray<PlanLine>
	below: ReadonlyArray<string>
}

function height_of(line: string, columns: number): number {
	const width = string_width(stripVTControlCharacters(line))

	return Math.max(1, Math.ceil(width / Math.max(1, columns)))
}

function heights(lines: ReadonlyArray<string>, columns: number): number {
	return lines.reduce((sum, line) => sum + height_of(line, columns), 0)
}

// The size left once `lines` below the frame are written — the live screen's footer.
function reserve(size: TerminalSize, lines: ReadonlyArray<string>): TerminalSize {
	return { ...size, rows: size.rows - heights(lines, size.columns) }
}

// How many leading plan lines fit in `room` rows.
function fitting(plan: ReadonlyArray<PlanLine>, room: number, columns: number): number {
	let used = 0
	const count = plan.findIndex((line) => {
		used += height_of(line.text, columns)

		return used > room
	})

	return count === -1 ? plan.length : count
}

// A cut that ends on a blank, a rule or an epic whose children it cut ends on its last row instead.
// The first line, the blank under the header, stays.
function trimmed(kept: ReadonlyArray<PlanLine>): Array<PlanLine> {
	const last = kept.findLastIndex((line, index) => line.rows > 0 || index === 0)

	return kept.slice(0, last + 1)
}

function count_rows(lines: ReadonlyArray<PlanLine>): number {
	return lines.reduce((sum, line) => sum + line.rows, 0)
}

// The plan cut to the rows left between the parts that stay, one row kept for the `more N` line.
function cut_plan(parts: FrameParts, size: TerminalSize): Array<string> {
	const { columns } = size
	const room = size.rows - heights(parts.above, columns) - heights(parts.below, columns) - 1
	const count = fitting(parts.plan, room, columns)
	const kept = trimmed(parts.plan.slice(0, count))
	const hidden = count_rows(parts.plan) - count_rows(kept)
	const more = hidden > 0 ? [`${INDENT}${WORDS.more} ${String(hidden)}`] : []

	return [...kept.map((line) => line.text), ...more]
}

// The leading lines that fit, for a pane too short even for what stays: the top is what is kept.
function clamped(lines: ReadonlyArray<string>, size: TerminalSize): Array<string> {
	let used = 0

	return lines.filter((line) => {
		used += height_of(line, size.columns)

		return used <= size.rows
	})
}

function fit(parts: FrameParts, size: TerminalSize): Array<string> {
	const whole = [...parts.above, ...parts.plan.map((line) => line.text), ...parts.below]

	if (heights(whole, size.columns) <= size.rows) return whole

	return clamped([...parts.above, ...cut_plan(parts, size), ...parts.below], size)
}

const run_board_fit = { fit, height_of, reserve }

export { run_board_fit }
export type { FrameParts, PlanLine, TerminalSize }
