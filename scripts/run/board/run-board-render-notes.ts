import { issue_cite } from '#scripts/issue/issue-cite'
import { run_board_kind } from './run-board-kind'
import { run_board_labels, type Words } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import type { BoardNote } from './run-board-notes'

// The findings section of `run:board`, under the 🙋 decision rows, and the part of the legend that
// names its symbols. A finding is read to the minute, and the legend names only the kinds the section
// draws — the rows' legend's rule — so a section of filed Issues alone is not explained with 💬 and 💤.

const { FILED_KIND_ICONS, KIND_WORDS, NOTES_ICON, NOTE_ICONS, WORDS, minute_of } = run_board_labels
const NOTE_LIMIT = 6
const GAP = '  '
const INDENT = '  '
const NUMBER_PLACEHOLDER = '{n}'
// An `owner/repo#N` reference written out in a text.
const QUALIFIED_REFERENCE = /(?<![\w./-])(?<repo>[\w.-]+\/[\w.-]+)#(?<number>\d+)/gu
// The order a full section keeps its lines in, the line a person has to act on first
// (joshuafolkken/kit#4097).
const RANK_ORDER = ['park', 'filed', 'note'] as const

type Link = (reference: string) => string
type Rank = (typeof RANK_ORDER)[number]

// The plan the section is drawn under — none before it is read, where no legend is drawn either —, the
// link its numbers go through and the repository the plan was read for.
interface NotesView {
	layout: BoardLayout | undefined
	link: Link
	repo?: string | undefined
}

interface NotesBody {
	lines: Array<string>
	hidden: number
}

// One line the section can draw, with what it is kept by and the icon it leads with.
interface NoteItem {
	rank: number
	at_ms: number
	line: string
	icon: string
}

interface ItemsView {
	listed: ReadonlySet<number>
	has_legend: boolean
	link: Link
	repo: string | undefined
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
	return note.filed_kind === undefined ? NOTE_ICONS[note.kind] : FILED_KIND_ICONS[note.filed_kind]
}

function found_of(note: BoardNote, link: Link): string {
	if (note.found_during === undefined) return ''

	return WORDS.found_during.split(NUMBER_PLACEHOLDER).join(link(note.found_during))
}

// A reference to the board's own repository is drawn as `#N`; another repository's keeps its name.
function unqualified(text: string, repo: string | undefined): string {
	if (repo === undefined) return text

	return text.replaceAll(QUALIFIED_REFERENCE, (whole, named: string, number: string) =>
		named === repo ? issue_cite.plain(number) : whole,
	)
}

function body_of(note: BoardNote, view: ItemsView): string {
	return unqualified(note.text, view.repo)
}

// Where the legend names the symbols a note leads with its icon alone; where no legend is drawn it
// keeps the kind's word.
function note_text(note: BoardNote, view: ItemsView): string {
	const { has_legend, link } = view
	const kind = has_legend ? undefined : WORDS[note.kind]
	const issue = note.issue === undefined ? undefined : link(note.issue)
	const lead = [note_icon(note), minute_of(note.at_ms), issue, kind]
		.filter((part) => part !== undefined)
		.join(' ')

	return `${INDENT}${lead}${GAP}${body_of(note, view)}${found_of(note, link)}`
}

function rank_index(rank: Rank): number {
	return RANK_ORDER.indexOf(rank)
}

function note_item(note: BoardNote, view: ItemsView): NoteItem {
	return {
		rank: rank_index(note.kind),
		at_ms: note.at_ms,
		line: note_text(note, view),
		icon: note_icon(note),
	}
}

// A filed Issue the plan draws a row for (`listed`, the rows' numbers) would name its title twice, so
// its row leads the title with ✚ instead (joshuafolkken/kit#4099).
function is_listed(note: BoardNote, listed: ReadonlySet<number>): boolean {
	return note.kind === 'filed' && listed.has(Number(note.issue))
}

function listed_of(rows: ReadonlyArray<BoardRow>): Set<number> {
	return new Set(rows.map((row) => row.number))
}

function rest_of(notes: ReadonlyArray<BoardNote>, listed: ReadonlySet<number>): Array<BoardNote> {
	return notes.filter((note) => !is_listed(note, listed))
}

function by_rank(left: NoteItem, right: NoteItem): number {
	return left.rank - right.rank || right.at_ms - left.at_ms
}

// Every line the section can draw, in the order it keeps them: by rank, then newest first.
function items_of(notes: ReadonlyArray<BoardNote>, view: ItemsView): Array<NoteItem> {
	return rest_of(notes, view.listed)
		.map((note) => note_item(note, view))
		.toSorted(by_rank)
}

// The first few by rank, so the section never pushes the plan off the screen, and how many more there
// are; the frame counts the rest together with any it cuts to fit, from the bottom, so the lowest rank
// gives way first. Their numbers go through the board's
// `header.link`, so they open their GitHub issue as the plan's rows do.
function note_lines(notes: ReadonlyArray<BoardNote>, view: NotesView): NotesBody {
	const { layout, link, repo } = view
	const has_legend = layout !== undefined
	const listed = listed_of(has_legend ? run_board_layout.rows_of(layout) : [])
	const items = items_of(notes, { listed, has_legend, link, repo })
	const lines = items.slice(0, NOTE_LIMIT).map((item) => item.line)

	return { lines, hidden: items.length - lines.length }
}

function same(reference: string): string {
	return reference
}

// 📌 while the section is on screen, then each kind a drawn line leads with — one the rows' legend
// already names (`named`) is not named twice.
function notes_legend(
	notes: ReadonlyArray<BoardNote>,
	named: ReadonlySet<string>,
	rows: ReadonlyArray<BoardRow>,
): Array<string> {
	const view = { listed: listed_of(rows), has_legend: true, link: same, repo: undefined }
	const shown = items_of(notes, view).slice(0, NOTE_LIMIT)

	if (shown.length === 0) return []

	const drawn = new Set(shown.map((item) => item.icon))
	const kinds = NOTE_LEGEND.filter(([icon]) => drawn.has(icon) && !named.has(icon)).map(
		([icon, word]) => `${icon} ${WORDS[word]}`,
	)

	return [`${NOTES_ICON} ${WORDS.notes}`, ...kinds]
}

const run_board_render_notes = { NOTE_LIMIT, note_lines, notes_legend }

export { run_board_render_notes, type NotesView }
