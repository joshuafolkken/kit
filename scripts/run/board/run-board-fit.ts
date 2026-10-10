import { stripVTControlCharacters } from 'node:util'
import string_width from 'string-width'
import { run_board_labels } from './run-board-labels'

// A live `run:board` frame kept within the terminal. A frame taller than the pane scrolls the
// alternate screen as it is written, and the header — the lines that say whether the run moves and
// how far it is — is what scrolls off. So the parts below it give way instead, least wanted first:
// the footer, the legend, the finished rows, the notes, the rows not yet started, the parked rows
// and, last, the running rows — what a person keeps the board open to see. Each stage stops once the
// frame fits, a cut row is counted on its section's `more N` line, and the order a row is drawn in
// never changes. A line wider than the pane wraps, so every line is counted by the rows it takes on
// screen, not as one.

const { WORDS } = run_board_labels
const INDENT = '  '

interface TerminalSize {
	rows: number
	columns: number
}

// The stage an issue row gives way in, the earlier first.
type YieldStage = 'finished' | 'pending' | 'parked' | 'running'

// When a row's stage gives it way: the oldest first, a row with no time before every timed one.
interface RowYield {
	stage: YieldStage
	at_ms: number | undefined
}

// One line of the plan, an issue row with when it gives way; a rule, a blank or an epic's own line none.
interface PlanLine {
	text: string
	row: RowYield | undefined
}

// A plan section drops its heading once none of its rows is left.
interface PlanSection {
	head: ReadonlyArray<string>
	lines: ReadonlyArray<PlanLine>
}

// The newest notes shown, and how many older ones are already past the section's limit.
interface NotesPart {
	head: ReadonlyArray<string>
	lines: ReadonlyArray<string>
	hidden: number
}

// A frame in its parts, top to bottom: the header above stays.
interface FrameParts {
	above: ReadonlyArray<string>
	plan: ReadonlyArray<PlanSection>
	notes: NotesPart
	legend: ReadonlyArray<string>
	footer: ReadonlyArray<string>
}

// One thing that gives way: a part as a whole, one note (the oldest shown), or one issue row.
type Yielder = 'footer' | 'legend' | 'note' | PlanLine

interface Cut {
	footer: boolean
	legend: boolean
	notes: number
	rows: ReadonlySet<PlanLine>
}

const NO_CUT: Cut = { footer: false, legend: false, notes: 0, rows: new Set() }

// The columns a line takes on screen: its color escapes take none, an emoji two.
function width_of(line: string): number {
	return string_width(stripVTControlCharacters(line))
}

function height_of(line: string, columns: number): number {
	return Math.max(1, Math.ceil(width_of(line) / Math.max(1, columns)))
}

function heights(lines: ReadonlyArray<string>, columns: number): number {
	return lines.reduce((sum, line) => sum + height_of(line, columns), 0)
}

function more_lines(hidden: number): Array<string> {
	return hidden > 0 ? [`${INDENT}${WORDS.more} ${String(hidden)}`] : []
}

// A section that ends on an epic whose children were all cut ends on its last row instead.
function section_lines(section: PlanSection, cut: ReadonlySet<PlanLine>): Array<string> {
	const kept = section.lines.filter((line) => !cut.has(line))
	const last = kept.findLastIndex((line) => line.row !== undefined)

	if (last === -1) return []

	return [...section.head, ...kept.slice(0, last + 1).map((line) => line.text)]
}

// The plan's cut rows are counted on one line at its end, under a blank when no section is left.
function plan_lines(plan: ReadonlyArray<PlanSection>, cut: ReadonlySet<PlanLine>): Array<string> {
	const drawn = plan.flatMap((section) => section_lines(section, cut))
	const lead = drawn.length === 0 && cut.size > 0 ? [''] : []

	return [...lead, ...drawn, ...more_lines(cut.size)]
}

// The notes give way from the oldest shown; with none left the section goes, heading and all.
function notes_lines(notes: NotesPart, cut: number): Array<string> {
	const kept = notes.lines.slice(0, notes.lines.length - cut)

	if (kept.length === 0) return []

	return [...notes.head, ...kept, ...more_lines(notes.hidden + cut)]
}

function compose(parts: FrameParts, cut: Cut): Array<string> {
	return [
		...parts.above,
		...plan_lines(parts.plan, cut.rows),
		...notes_lines(parts.notes, cut.notes),
		...(cut.legend ? [] : parts.legend),
		...(cut.footer ? [] : parts.footer),
	]
}

interface Indexed {
	line: PlanLine
	index: number
}

function at_of(entry: Indexed): number {
	return entry.line.row?.at_ms ?? -Infinity
}

// The oldest first; rows with the same time — the rows not yet started have none — from the plan's end.
function oldest_first(left: Indexed, right: Indexed): number {
	const [left_at, right_at] = [at_of(left), at_of(right)]

	if (left_at === right_at) return right.index - left.index

	return left_at < right_at ? -1 : 1
}

function yielding(rows: ReadonlyArray<Indexed>, stage: YieldStage): Array<PlanLine> {
	return rows
		.filter((entry) => entry.line.row?.stage === stage)
		.toSorted(oldest_first)
		.map((entry) => entry.line)
}

// Everything that gives way, in the order it does.
function order_of(parts: FrameParts): Array<Yielder> {
	const rows = parts.plan
		.flatMap((section) => section.lines)
		.map((line, index) => ({ line, index }))
		.filter((entry) => entry.line.row !== undefined)
	const notes = parts.notes.lines.map((): Yielder => 'note')

	return [
		'footer',
		'legend',
		...yielding(rows, 'finished'),
		...notes,
		...yielding(rows, 'pending'),
		...yielding(rows, 'parked'),
		...yielding(rows, 'running'),
	]
}

function is_line(item: Yielder): item is PlanLine {
	return typeof item !== 'string'
}

// What the first `count` of the order cuts.
function cut_of(order: ReadonlyArray<Yielder>, count: number): Cut {
	const gone = order.slice(0, count)

	return {
		footer: gone.includes('footer'),
		legend: gone.includes('legend'),
		notes: gone.filter((item) => item === 'note').length,
		rows: new Set(gone.filter((item) => is_line(item))),
	}
}

// The leading lines that fit, for a pane too short even for the header: the top is what is kept.
function clamped(lines: ReadonlyArray<string>, size: TerminalSize): Array<string> {
	let used = 0

	return lines.filter((line) => {
		used += height_of(line, size.columns)

		return used <= size.rows
	})
}

// A frame drawn whole, where no terminal bounds it.
function whole(parts: FrameParts): Array<string> {
	return compose(parts, NO_CUT)
}

// The frames each longer cut of the order leaves, the uncut whole first.
function frames_of(parts: FrameParts): Array<Array<string>> {
	const order = order_of(parts)
	const counts = Array.from({ length: order.length + 1 }, (_, count) => count)

	return counts.map((count) => compose(parts, cut_of(order, count)))
}

function fit(parts: FrameParts, size: TerminalSize): Array<string> {
	const frames = frames_of(parts)
	const fitting = frames.find((frame) => heights(frame, size.columns) <= size.rows)

	return clamped(fitting ?? frames.at(-1) ?? [], size)
}

const run_board_fit = { fit, height_of, whole, width_of }

export { run_board_fit }
export type { FrameParts, NotesPart, PlanLine, PlanSection, RowYield, TerminalSize, YieldStage }
