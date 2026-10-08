import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels, type Words } from './run-board-labels'
import type { BoardRow, WaveEntry } from './run-board-layout'
import type { BoardNote } from './run-board-notes'

// The whole `run:board` screen as lines (joshuafolkken/kit#3430) — pure, so what a person sees is tested
// apart from the terminal. The header says where the run is; the sections below it follow the plan's
// order; the findings at the bottom are what the run would otherwise have said in no chat anyone reads.

const { STATE_ICONS, clock_of, span_of } = run_board_labels
const TITLE_LIMIT = 40
const ELLIPSIS = '…'
const NOTE_LIMIT = 6
const GAP = '  '
const INDENT = '  '
const BRANCH = '     ├ '
const LAST_BRANCH = '     └ '
const NUMBER_PLACEHOLDER = '{n}'
const NOTE_ICONS: Readonly<Record<BoardNote['kind'], string>> = {
	filed: '🐞',
	park: STATE_ICONS.parked,
	note: '💬',
}

interface BoardView {
	header: BoardHeader
	notes: ReadonlyArray<BoardNote>
}

function title_of(row: BoardRow): string {
	const title = row.title ?? ''

	return title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT - 1)}${ELLIPSIS}` : title
}

// A running row reads its start and how long it has run; a settled one its whole span.
function times_of(row: BoardRow, now_ms: number): string | undefined {
	const started = row.status?.started_ms

	if (started === undefined) return undefined

	const ended = row.status?.ended_ms

	if (ended === undefined) return `${clock_of(started)} (${span_of(now_ms - started)})`

	return `${clock_of(started)} → ${clock_of(ended)} (${span_of(ended - started)})`
}

function waits_of(row: BoardRow, words: Words): string | undefined {
	if (row.waits.length === 0) return undefined

	return `← ${words.waits}: ${row.waits.join(', ')}`
}

function row_text(row: BoardRow, header: BoardHeader): string {
	const parts = [
		`${STATE_ICONS[row.state]} ${String(row.number)}`,
		title_of(row),
		times_of(row, header.now_ms),
		row.status?.lane,
		waits_of(row, header.words),
	]

	return parts.filter((part) => part !== undefined && part !== '').join(GAP)
}

function epic_lines(
	entry: Extract<WaveEntry, { kind: 'epic' }>,
	header: BoardHeader,
): Array<string> {
	const last = entry.rows.length - 1
	const children = entry.rows.map(
		(row, index) => `${index === last ? LAST_BRANCH : BRANCH}${row_text(row, header)}`,
	)

	return [`${INDENT}📁 epic ${String(entry.epic)}`, ...children]
}

function entry_lines(entry: WaveEntry, header: BoardHeader): Array<string> {
	if (entry.kind === 'row') return [`${INDENT}${row_text(entry.row, header)}`]

	return epic_lines(entry, header)
}

function section(heading: string, lines: ReadonlyArray<string>): Array<string> {
	return lines.length === 0 ? [] : ['', heading, ...lines]
}

function rows_section(
	heading: string,
	rows: ReadonlyArray<BoardRow>,
	header: BoardHeader,
): Array<string> {
	return section(
		heading,
		rows.map((row) => `${INDENT}${row_text(row, header)}`),
	)
}

function plan_sections(header: BoardHeader): Array<string> {
	const { layout, words } = header

	if (layout === undefined) return []

	const waves = layout.waves.flatMap((wave, index) =>
		section(
			`Wave ${String(index + 1)}`,
			wave.flatMap((entry) => entry_lines(entry, header)),
		),
	)

	return [
		...rows_section(words.active, layout.active, header),
		...waves,
		...rows_section(words.people, layout.people, header),
		...rows_section(words.unreached, layout.unreached, header),
	]
}

function note_icon(note: BoardNote): string {
	return note.is_decision ? STATE_ICONS.human : NOTE_ICONS[note.kind]
}

function found_of(note: BoardNote, words: Words): string {
	if (note.found_during === undefined) return ''

	return words.found_during.split(NUMBER_PLACEHOLDER).join(note.found_during)
}

function note_text(note: BoardNote, words: Words): string {
	const issue = note.issue === undefined ? '' : `${note.issue} `
	const lead = `${note_icon(note)} ${clock_of(note.at_ms)} ${issue}${words[note.kind]}`

	return `${INDENT}${lead}${GAP}${note.text}${found_of(note, words)}`
}

// The newest few, and how many more there are, so the section never pushes the plan off the screen.
function notes_section(notes: ReadonlyArray<BoardNote>, words: Words): Array<string> {
	const shown = notes.slice(0, NOTE_LIMIT).map((note) => note_text(note, words))
	const hidden = notes.length - shown.length
	const more = hidden > 0 ? [`${INDENT}${words.more} ${String(hidden)}`] : []

	return section(words.notes, [...shown, ...more])
}

function render(view: BoardView): Array<string> {
	const { header, notes } = view

	return [
		...run_board_header.header_lines(header),
		...plan_sections(header),
		...notes_section(notes, header.words),
	]
}

function render_no_run(now_ms: number, words: Words): Array<string> {
	return [`backlogrun ${words.no_run} · ${words.updated} ${clock_of(now_ms)}`]
}

const run_board_render = {
	NOTE_LIMIT,
	TITLE_LIMIT,
	render,
	render_no_run,
}

export { run_board_render }
export type { BoardView }
