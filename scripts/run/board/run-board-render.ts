import { styleText } from 'node:util'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels, type Words } from './run-board-labels'
import type { BoardRow, WaveEntry } from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import { run_board_phase } from './run-board-phase'

// The whole `run:board` screen as lines (joshuafolkken/kit#3430) — pure, so what a person sees is tested
// apart from the terminal. The header says where the run is; the sections below it follow the plan's
// order; the findings at the bottom are what the run would otherwise have said in no chat anyone reads.
// A section is a rule rather than a heading, and the legend at the foot names the symbols, so a row
// carries only what differs between rows (joshuafolkken/kit#3444).

const { STATE_ICONS, WAITS_ICON, bar_of, clock_of, elapsed_of } = run_board_labels
const TITLE_LIMIT = 40
const ELLIPSIS = '…'
const NOTE_LIMIT = 6
const GAP = '  '
const INDENT = '  '
const BRANCH = '     ├ '
const LAST_BRANCH = '     └ '
// A waiting row draws no icon; the blank holds the emoji's two columns so its number lines up.
const BLANK_ICON = '  '
const RULE = '─'
const RULE_LEAD = `${RULE}${RULE}`
const RULE_WIDTH = 50
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

// What every row of one frame is drawn with: the header, and how wide the time column is, so a
// three-digit `125:30` and a `00:42` end in the same column.
interface RowFrame {
	header: BoardHeader
	time_width: number
}

function title_of(title = ''): string {
	return title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT - 1)}${ELLIPSIS}` : title
}

// A running row runs until now; a settled one until its recorded end. A child settled from the open
// listing has none, so it draws no time rather than one that keeps counting.
function end_of(row: BoardRow, now_ms: number): number | undefined {
	return row.state === 'running' ? now_ms : row.status?.ended_ms
}

// How long a row has run: a running one until now, a settled one its whole span.
function elapsed_ms(row: BoardRow, now_ms: number): number | undefined {
	const started = row.status?.started_ms
	const ended = end_of(row, now_ms)

	if (started === undefined || ended === undefined) return undefined

	return ended - started
}

function time_of(row: BoardRow, now_ms: number): string | undefined {
	const elapsed = elapsed_ms(row, now_ms)

	return elapsed === undefined ? undefined : elapsed_of(elapsed)
}

// A running row's phase as the shared bar, filled by the phases it has passed, and the phase's name.
function phase_of(row: BoardRow): string | undefined {
	const phase = row.status?.phase

	if (phase === undefined || row.state !== 'running') return undefined

	return `${bar_of(run_board_phase.index_of(phase), run_board_phase.PHASES.length)} ${phase}`
}

function waits_of(row: BoardRow): string | undefined {
	if (row.waits.length === 0) return undefined

	return `${WAITS_ICON} ${row.waits.join(', ')}`
}

// The title is padded to its limit only where a time follows it, so the times form one column.
function timed_parts(row: BoardRow, frame: RowFrame): Array<string | undefined> {
	const time = time_of(row, frame.header.now_ms)

	if (time === undefined) return [title_of(row.title)]

	return [title_of(row.title).padEnd(TITLE_LIMIT), time.padStart(frame.time_width), phase_of(row)]
}

function icon_of(row: BoardRow): string {
	return row.state === 'waiting' ? BLANK_ICON : STATE_ICONS[row.state]
}

function row_text(row: BoardRow, frame: RowFrame, lead = `${icon_of(row)} `): string {
	const parts = [`${lead}${String(row.number)}`, ...timed_parts(row, frame), waits_of(row)]

	return parts.filter((part) => part !== undefined && part !== '').join(GAP)
}

// Under an epic's branch a waiting child needs no blank: the branch already holds the column.
function child_lead(row: BoardRow): string {
	return row.state === 'waiting' ? '' : `${STATE_ICONS[row.state]} `
}

function epic_lines(entry: Extract<WaveEntry, { kind: 'epic' }>, frame: RowFrame): Array<string> {
	const last = entry.rows.length - 1
	const children = entry.rows.map(
		(row, index) =>
			`${index === last ? LAST_BRANCH : BRANCH}${row_text(row, frame, child_lead(row))}`,
	)
	const title = title_of(entry.title)
	const epic = title === '' ? String(entry.epic) : `${String(entry.epic)}${GAP}${title}`

	return [`${INDENT}📁 ${epic}`, ...children]
}

function entry_lines(entry: WaveEntry, frame: RowFrame): Array<string> {
	if (entry.kind === 'row') return [`${INDENT}${row_text(entry.row, frame)}`]

	return epic_lines(entry, frame)
}

function rule_of(label: string): string {
	return `${RULE_LEAD} ${label} `.padEnd(RULE_WIDTH, RULE)
}

function section(heading: string | undefined, lines: ReadonlyArray<string>): Array<string> {
	if (lines.length === 0) return []

	return heading === undefined ? ['', ...lines] : ['', rule_of(heading), ...lines]
}

function rows_section(
	heading: string | undefined,
	rows: ReadonlyArray<BoardRow>,
	frame: RowFrame,
): Array<string> {
	return section(
		heading,
		rows.map((row) => `${INDENT}${row_text(row, frame)}`),
	)
}

// The time column's width: the widest time any active row draws in this frame.
function time_width(header: BoardHeader): number {
	const times = (header.layout?.active ?? []).map((row) => time_of(row, header.now_ms) ?? '')

	return Math.max(0, ...times.map((time) => time.length))
}

function legend_of(words: Words): string {
	const legend = [
		`${STATE_ICONS.merged} ${words.merged}`,
		`${STATE_ICONS.parked} ${words.parked}`,
		`${STATE_ICONS.running} ${words.in_progress}`,
		`${STATE_ICONS.waiting} ${words.waiting}`,
		`${STATE_ICONS.human} ${words.decision}`,
		`${WAITS_ICON} ${words.waits}`,
	].join(GAP)

	return styleText('dim', legend)
}

function plan_sections(header: BoardHeader): Array<string> {
	const { layout } = header

	if (layout === undefined) return []

	const frame = { header, time_width: time_width(header) }
	const waves = layout.waves.flatMap((wave, index) =>
		section(
			String(index + 1),
			wave.flatMap((entry) => entry_lines(entry, frame)),
		),
	)

	return [
		...rows_section(undefined, layout.active, frame),
		...waves,
		...rows_section(STATE_ICONS.human, layout.people, frame),
		...rows_section(WAITS_ICON, layout.unreached, frame),
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
	const legend = header.layout === undefined ? [] : ['', legend_of(header.words)]

	return [
		...run_board_header.header_lines(header),
		...plan_sections(header),
		...notes_section(notes, header.words),
		...legend,
	]
}

function render_no_run(now_ms: number, words: Words): Array<string> {
	return [`■ backlogrun${GAP}${words.no_run}${GAP}${clock_of(now_ms)}`]
}

const run_board_render = {
	NOTE_LIMIT,
	TITLE_LIMIT,
	render,
	render_no_run,
}

export { run_board_render }
export type { BoardView }
