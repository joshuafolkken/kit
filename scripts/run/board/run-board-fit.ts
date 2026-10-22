import { stripVTControlCharacters } from 'node:util'
import string_width from 'string-width'
import { run_board_labels } from './run-board-labels'

// A live `run:board` frame kept within the terminal. A frame taller than the pane scrolls the
// alternate screen as it is written, and the header — the lines that say whether the run moves and
// how far it is — is what scrolls off. So the parts below it give way instead, least wanted first and
// in the order the frame draws them from the bottom (joshuafolkken/kit#4099): the footer, the legend,
// the rows under the notes — the finished, the 🔗 waiting, the not yet started — the notes from the
// oldest, the reviewers thanked above the legend, the parked rows and, last, the rows waiting on a person's decision
// and the running rows — what a person keeps the board open to see. Each stage stops once the
// frame fits, a cut row is counted on the plan's `more N` line — or on its folding section's own last
// line while that section keeps a row (joshuafolkken/kit#4042) — and the order a row is drawn in
// never changes. A line wider than the pane wraps, so every line is counted by the rows it takes on
// screen, not as one.

const { WORDS } = run_board_labels
const INDENT = '  '

interface TerminalSize {
	rows: number
	columns: number
}

// The stage an issue row gives way in, the earlier first.
type YieldStage = 'finished' | 'waiting' | 'pending' | 'parked' | 'decision' | 'running'

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

// A section a person folds and unfolds with one key on a live board (`run-board-fold.ts`).
type SectionKey = 'lanes' | 'processes' | 'findings' | 'queued' | 'waiting' | 'done'

// What a foldable part's rule is labeled, and whether a person folded it to its heading alone.
interface Foldable {
	label?: string | undefined
	is_folded?: boolean | undefined
}

// A plan section drops its heading once none of its rows is left — unless it folds: then its cut rows
// are counted on its own last line, drawn by `fold`, rather than on the plan's `more N`. A folded one
// is its heading alone.
interface PlanSection extends Foldable {
	head: ReadonlyArray<string>
	lines: ReadonlyArray<PlanLine>
	fold?: ((cut: ReadonlyArray<PlanLine>) => string) | undefined
	key?: SectionKey | undefined
}

// The newest notes shown, and how many older ones are already past the section's limit.
interface NotesPart extends Foldable {
	head: ReadonlyArray<string>
	lines: ReadonlyArray<string>
	hidden: number
}

// A part drawn after `plan` whose lines a group's parts are, `is_detail`, and give way all at once;
// `summary` is what its folded heading says.
interface DetailPart extends Foldable {
	head: ReadonlyArray<string>
	lines: ReadonlyArray<{ text: string; is_detail: boolean }>
	summary?: string | undefined
}

// A frame in its parts, top to bottom: the header above stays. The plan's sections are drawn around
// the notes: `plan` above them, `below` under them; `processes` between the plan and the notes.
interface FrameParts {
	above: ReadonlyArray<string>
	plan: ReadonlyArray<PlanSection>
	processes?: DetailPart | undefined
	notes: NotesPart
	below?: ReadonlyArray<PlanSection> | undefined
	// The reviewers thanked, drawn right above the legend; none where nobody is.
	thanks?: ReadonlyArray<string> | undefined
	legend: ReadonlyArray<string>
	footer: ReadonlyArray<string>
}

// One thing that gives way: a part as a whole, the processes' details, one note (the oldest shown),
// or one issue row.
type Yielder = 'thanks' | 'footer' | 'legend' | 'details' | 'note' | PlanLine

interface Cut {
	thanks: boolean
	footer: boolean
	legend: boolean
	details: boolean
	notes: number
	rows: ReadonlySet<PlanLine>
}

const NO_CUT: Cut = {
	thanks: false,
	footer: false,
	legend: false,
	details: false,
	notes: 0,
	rows: new Set(),
}

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
function kept_lines(section: PlanSection, cut: ReadonlySet<PlanLine>): Array<string> {
	const kept = section.lines.filter((line) => !cut.has(line))
	const last = kept.findLastIndex((line) => line.row !== undefined)

	return kept.slice(0, last + 1).map((line) => line.text)
}

// A folding section counts its own cut rows while any of its rows is left; with none left it goes,
// and the plan's `more N` counts them.
function is_folding(section: PlanSection, cut: ReadonlySet<PlanLine>): boolean {
	return section.fold !== undefined && kept_lines(section, cut).length > 0
}

// The fold line a folding section ends on while any of its rows is cut.
function fold_lines(section: PlanSection, cut: ReadonlySet<PlanLine>): Array<string> {
	const gone = section.lines.filter((line) => cut.has(line))

	if (!is_folding(section, cut) || gone.length === 0) return []

	return [section.fold?.(gone) ?? '']
}

function section_lines(section: PlanSection, cut: ReadonlySet<PlanLine>): Array<string> {
	if (section.is_folded === true) return [...section.head]

	const kept = kept_lines(section, cut)

	if (kept.length === 0) return []

	return [...section.head, ...kept, ...fold_lines(section, cut)]
}

// The cut rows no folding section counts.
function unfolded(plan: ReadonlyArray<PlanSection>, cut: ReadonlySet<PlanLine>): number {
	const folding = plan.filter((section) => is_folding(section, cut))
	const folded = new Set(folding.flatMap((section) => section.lines))

	return [...cut].filter((line) => !folded.has(line)).length
}

// The notes give way from the oldest shown; with none left the section goes, heading and all.
function notes_lines(notes: NotesPart, cut: number): Array<string> {
	if (notes.is_folded === true) return [...notes.head]

	const kept = notes.lines.slice(0, notes.lines.length - cut)

	if (kept.length === 0) return []

	return [...notes.head, ...kept, ...more_lines(notes.hidden + cut)]
}

function sections_lines(
	sections: ReadonlyArray<PlanSection>,
	cut: ReadonlySet<PlanLine>,
): Array<string> {
	return sections.flatMap((section) => section_lines(section, cut))
}

// The processes under their heading, the groups alone once their details are cut.
function detail_lines(part: DetailPart | undefined, is_cut: boolean): Array<string> {
	if (part === undefined) return []

	const kept = part.lines.filter((line) => !is_cut || !line.is_detail)

	return [...part.head, ...kept.map((line) => line.text)]
}

// The plan's sections around the notes, its cut rows counted on one line after its last drawn section —
// under `below` while any of it is drawn, else above the processes and the notes, never under the
// notes' own `more` — and under a blank when no section is left above it.
function body_lines(parts: FrameParts, cut: Cut): Array<string> {
	const below = parts.below ?? []
	const [plan, notes, under] = [
		sections_lines(parts.plan, cut.rows),
		[...detail_lines(parts.processes, cut.details), ...notes_lines(parts.notes, cut.notes)],
		sections_lines(below, cut.rows),
	]
	const more = more_lines(unfolded([...parts.plan, ...below], cut.rows))

	if (under.length > 0) return [...plan, ...notes, ...under, ...more]

	const lead = plan.length === 0 && more.length > 0 ? [''] : []

	return [...lead, ...plan, ...more, ...notes]
}

function compose(parts: FrameParts, cut: Cut): Array<string> {
	return [
		...parts.above,
		...body_lines(parts, cut),
		...(cut.thanks ? [] : (parts.thanks ?? [])),
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

// The stages in the order their rows give way.
const STAGES: ReadonlyArray<YieldStage> = [
	'finished',
	'waiting',
	'pending',
	'parked',
	'decision',
	'running',
]

// The issue rows of some sections, in the order they give way.
function rows_yielding(sections: ReadonlyArray<PlanSection>): Array<PlanLine> {
	const rows = sections
		.flatMap((section) => section.lines)
		.map((line, index) => ({ line, index }))
		.filter((entry) => entry.line.row !== undefined)

	return STAGES.flatMap((stage) => yielding(rows, stage))
}

// Everything that gives way, in the order it does: the rows drawn under the notes before them, the
// processes' details before the notes, the rows above them after the thanks.
function order_of(parts: FrameParts): Array<Yielder> {
	const notes = parts.notes.lines.map((): Yielder => 'note')

	return [
		'footer',
		'legend',
		...rows_yielding(parts.below ?? []),
		'details',
		...notes,
		'thanks',
		...rows_yielding(parts.plan),
	]
}

function is_line(item: Yielder): item is PlanLine {
	return typeof item !== 'string'
}

// What the first `count` of the order cuts.
function cut_of(order: ReadonlyArray<Yielder>, count: number): Cut {
	const gone = order.slice(0, count)

	return {
		thanks: gone.includes('thanks'),
		footer: gone.includes('footer'),
		legend: gone.includes('legend'),
		details: gone.includes('details'),
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
export type {
	DetailPart,
	FrameParts,
	NotesPart,
	PlanLine,
	PlanSection,
	RowYield,
	SectionKey,
	TerminalSize,
	YieldStage,
}
