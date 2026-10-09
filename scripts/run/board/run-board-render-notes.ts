import { run_board_kind } from './run-board-kind'
import { run_board_labels, type Words } from './run-board-labels'
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

type Link = (reference: string) => string

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

// The newest few, so the section never pushes the plan off the screen; the frame counts the rest
// together with any it cuts to fit. Their numbers go through the board's `header.link`, so they open
// their GitHub issue as the plan's rows do.
function note_lines(
	notes: ReadonlyArray<BoardNote>,
	has_legend: boolean,
	link: Link,
): Array<string> {
	return notes.slice(0, NOTE_LIMIT).map((note) => note_text(note, has_legend, link))
}

// 📌 while the section is on screen, then each kind a drawn line leads with —
// one the rows' legend already names (`named`) is not named twice.
function notes_legend(notes: ReadonlyArray<BoardNote>, named: ReadonlySet<string>): Array<string> {
	if (notes.length === 0) return []

	const drawn = new Set(notes.slice(0, NOTE_LIMIT).map((note) => note_icon(note)))
	const kinds = NOTE_LEGEND.filter(([icon]) => drawn.has(icon) && !named.has(icon)).map(
		([icon, word]) => `${icon} ${WORDS[word]}`,
	)

	return [`${NOTES_ICON} ${WORDS.notes}`, ...kinds]
}

const run_board_render_notes = { NOTE_LIMIT, note_lines, notes_legend }

export { run_board_render_notes }
