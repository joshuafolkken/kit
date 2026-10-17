import { run_board_kind } from './run-board-kind'
import { run_board_labels, type Words } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import type { BoardNote } from './run-board-notes'

// The findings section at the foot of `run:board` and the part of the legend that names its symbols.
// A finding is read to the minute, and the legend names only the kinds the section draws — the rows'
// legend's rule — so a section of filed Issues alone is not explained with 💬 and 💤.

const { FILED_KIND_ICONS, KIND_WORDS, NOTES_ICON, NOTE_ICONS, STATE_ICONS, WORDS, minute_of } =
	run_board_labels
const NOTE_LIMIT = 6
const GAP = '  '
const INDENT = '  '
const NUMBER_PLACEHOLDER = '{n}'
const RANGE = '–'

type Link = (reference: string) => string

// The plan the section is drawn under — none before it is read, where no legend is drawn either — and
// the link its numbers go through.
interface NotesView {
	layout: BoardLayout | undefined
	link: Link
}

interface NotesBody {
	lines: Array<string>
	hidden: number
}

interface Span {
	high: number
	low: number
}

// The icons the legend can name, in its order, each with its word — a filed kind's the rows' own
// (joshuafolkken/kit#3577), so one icon is never named with two words.
const NOTE_LEGEND: ReadonlyArray<readonly [string, keyof Words]> = [
	...run_board_kind.KIND_ORDER.map((kind) => [FILED_KIND_ICONS[kind], KIND_WORDS[kind]] as const),
	[NOTE_ICONS.filed, 'filed'],
	[NOTE_ICONS.park, 'parked'],
	[NOTE_ICONS.note, 'note'],
]

function note_icon(note: BoardNote): string {
	if (note.is_decision) return STATE_ICONS.human

	return note.filed_kind === undefined ? NOTE_ICONS[note.kind] : FILED_KIND_ICONS[note.filed_kind]
}

function found_of(note: BoardNote, link: Link): string {
	if (note.found_during === undefined) return ''

	return WORDS.found_during.split(NUMBER_PLACEHOLDER).join(link(note.found_during))
}

// Where the legend names the symbols a note leads with its icon alone; where no legend is drawn it
// keeps the kind's word.
function note_text(note: BoardNote, has_legend: boolean, link: Link): string {
	const kind = has_legend ? undefined : WORDS[note.kind]
	const issue = note.issue === undefined ? undefined : link(note.issue)
	const lead = [note_icon(note), minute_of(note.at_ms), issue, kind]
		.filter((part) => part !== undefined)
		.join(' ')

	return `${INDENT}${lead}${GAP}${note.text}${found_of(note, link)}`
}

// A filed Issue the plan draws a row for (`listed`, the rows' numbers) would name its title twice, so
// its number joins one `filed this run` line instead (joshuafolkken/kit#4046).
function is_listed(note: BoardNote, listed: ReadonlySet<number>): boolean {
	return note.kind === 'filed' && listed.has(Number(note.issue))
}

function listed_of(rows: ReadonlyArray<BoardRow>): Set<number> {
	return new Set(rows.map((row) => row.number))
}

function rest_of(notes: ReadonlyArray<BoardNote>, listed: ReadonlySet<number>): Array<BoardNote> {
	return notes.filter((note) => !is_listed(note, listed))
}

// Newest first, each run of consecutive numbers as one span.
function spans_of(numbers: ReadonlyArray<number>): Array<Span> {
	const spans: Array<Span> = []
	const newest = [...new Set(numbers)].toSorted((left, right) => right - left)

	for (const number of newest) {
		const last = spans.at(-1)

		if (last?.low === number + 1) last.low = number
		else spans.push({ high: number, low: number })
	}

	return spans
}

function span_text(span: Span, link: Link): string {
	const low = link(String(span.low))

	return span.low === span.high ? low : `${low}${RANGE}${link(String(span.high))}`
}

function filed_run_lines(
	notes: ReadonlyArray<BoardNote>,
	listed: ReadonlySet<number>,
	link: Link,
): Array<string> {
	const numbers = notes.filter((note) => is_listed(note, listed)).map((note) => Number(note.issue))

	if (numbers.length === 0) return []

	const spans = spans_of(numbers).map((span) => span_text(span, link))

	return [`${INDENT}${WORDS.filed_run}${GAP}${spans.join(GAP)}`]
}

// The newest few, so the section never pushes the plan off the screen, and how many more there are —
// the `filed this run` line counted as one; the frame counts the rest together with any it cuts to
// fit. Their numbers go through the board's `header.link`, so they open their GitHub issue as the
// plan's rows do.
function note_lines(notes: ReadonlyArray<BoardNote>, view: NotesView): NotesBody {
	const { layout, link } = view
	const has_legend = layout !== undefined
	const listed = listed_of(has_legend ? run_board_layout.rows_of(layout) : [])
	const rest = rest_of(notes, listed).map((note) => note_text(note, has_legend, link))
	const items = [...filed_run_lines(notes, listed, link), ...rest]
	const lines = items.slice(0, NOTE_LIMIT)

	return { lines, hidden: items.length - lines.length }
}

// 📌 while the section is on screen, then each kind a drawn line leads with —
// one the rows' legend already names (`named`) is not named twice; the `filed this run` line leads
// with none.
function notes_legend(
	notes: ReadonlyArray<BoardNote>,
	named: ReadonlySet<string>,
	rows: ReadonlyArray<BoardRow>,
): Array<string> {
	if (notes.length === 0) return []

	const rest = rest_of(notes, listed_of(rows))
	const shown = NOTE_LIMIT - (rest.length < notes.length ? 1 : 0)
	const drawn = new Set(rest.slice(0, shown).map((note) => note_icon(note)))
	const kinds = NOTE_LEGEND.filter(([icon]) => drawn.has(icon) && !named.has(icon)).map(
		([icon, word]) => `${icon} ${WORDS[word]}`,
	)

	return [`${NOTES_ICON} ${WORDS.notes}`, ...kinds]
}

const run_board_render_notes = { NOTE_LIMIT, note_lines, notes_legend }

export { run_board_render_notes, type NotesView }
