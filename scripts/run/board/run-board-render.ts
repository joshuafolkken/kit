import { styleText } from 'node:util'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels, type Words } from './run-board-labels'
import {
	run_board_layout,
	type BoardLayout,
	type BoardRow,
	type WaveEntry,
} from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import { run_board_phase, type Phase } from './run-board-phase'
import { run_board_track } from './run-board-track'

// The whole `run:board` screen as lines (joshuafolkken/kit#3430) — pure, so what a person sees is tested
// apart from the terminal. The header says where the run is; the sections below it follow the plan's
// order; the findings at the bottom are what the run would otherwise have said in no chat anyone reads.
// A section is a rule rather than a heading, and the legend at the foot names the symbols, so a row
// carries only what differs between rows (joshuafolkken/kit#3444).

const { HEADER_ICONS, NOTES_ICON, NOTE_ICONS, PHASE_ICONS, PHASE_WORDS, STATE_ICONS, WAITS_ICON } =
	run_board_labels
const { clock_of, elapsed_of } = run_board_labels
// The track is a fixed fourteen columns where the gauge and the phase's name took up to twenty-two, so
// the title takes the columns it freed and a row is no wider (joshuafolkken/kit#3460).
const TITLE_LIMIT = 48
const ELLIPSIS = '…'
const NOTE_LIMIT = 6
const GAP = '  '
const INDENT = '  '
const BRANCH = '     ├ '
const LAST_BRANCH = '     └ '
const RULE = '─'
const RULE_LEAD = `${RULE}${RULE}`
const RULE_WIDTH = 50
const NUMBER_PLACEHOLDER = '{n}'

interface BoardView {
	header: BoardHeader
	notes: ReadonlyArray<BoardNote>
	// The session a stopped run resumes from (joshuafolkken/kit#3437).
	resume?: string | undefined
}

// What every row of one frame is drawn with: the header, and how wide the time column is, so a
// three-digit `125:30` and a `00:42` end in the same column.
interface RowFrame {
	header: BoardHeader
	time_width: number
}

// A chat wraps a long line rather than cutting it, so its titles are drawn whole (joshuafolkken/kit#3456).
function title_of(header: BoardHeader, title = ''): string {
	if (header.form === 'chat') return title

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

// The phase a row draws: a running row's, and none for a settled one.
function shown_phase(row: BoardRow): Phase | undefined {
	return row.state === 'running' ? row.status?.phase : undefined
}

// A running row's phase as its track (joshuafolkken/kit#3460), so every row's phase is one column.
function phase_of(row: BoardRow): string | undefined {
	const phase = shown_phase(row)

	return phase === undefined ? undefined : run_board_track.track_of(phase)
}

// The phases a row's track draws — every one its row has passed (joshuafolkken/kit#3460) — which the
// legend names and whose newest leads a running row.
function drawn_phases(row: BoardRow): Array<Phase> {
	const phase = shown_phase(row)

	return phase === undefined ? [] : run_board_track.passed_of(phase)
}

function waits_of(row: BoardRow, header: BoardHeader): string | undefined {
	if (row.waits.length === 0) return undefined

	return `${WAITS_ICON} ${row.waits.map((reference) => header.link(reference)).join(', ')}`
}

// The title is padded to its limit only where a time follows it, so the times form one column.
function timed_parts(row: BoardRow, frame: RowFrame): Array<string | undefined> {
	const time = time_of(row, frame.header.now_ms)

	const title = title_of(frame.header, row.title)

	if (time === undefined) return [title]

	return [title.padEnd(TITLE_LIMIT), time.padStart(frame.time_width), phase_of(row)]
}

// A running row leads with the icon of the phase it is in now (joshuafolkken/kit#3471) — the rightmost
// icon of its track — and with 🔄 while its track draws none yet.
function state_icon(row: BoardRow): string {
	const current = drawn_phases(row).at(-1)

	return current === undefined ? STATE_ICONS[row.state] : PHASE_ICONS[current]
}

// A running row turns the spinner in the first column of its indent where the header has one
// (joshuafolkken/kit#3471), so its title starts in the same column as every other row's.
function indent_of(prefix: string, row: BoardRow, header: BoardHeader): string {
	if (row.state !== 'running' || header.spinner === undefined) return prefix

	return `${header.spinner}${prefix.slice(1)}`
}

// Every row carries its state's icon, a waiting one ⏳ too (joshuafolkken/kit#3450).
function row_text(row: BoardRow, frame: RowFrame): string {
	const { header } = frame
	const lead = `${state_icon(row)} ${header.link(String(row.number))}`
	const parts = [lead, ...timed_parts(row, frame), waits_of(row, header)]

	return parts.filter((part) => part !== undefined && part !== '').join(GAP)
}

function row_line(prefix: string, row: BoardRow, frame: RowFrame): string {
	return `${indent_of(prefix, row, frame.header)}${row_text(row, frame)}`
}

function epic_lines(entry: Extract<WaveEntry, { kind: 'epic' }>, frame: RowFrame): Array<string> {
	const last = entry.rows.length - 1
	const children = entry.rows.map((row, index) =>
		row_line(index === last ? LAST_BRANCH : BRANCH, row, frame),
	)
	const title = title_of(frame.header, entry.title)
	const number = frame.header.link(String(entry.epic))
	const epic = title === '' ? number : `${number}${GAP}${title}`

	return [`${INDENT}📁 ${epic}`, ...children]
}

function entry_lines(entry: WaveEntry, frame: RowFrame): Array<string> {
	if (entry.kind === 'row') return [row_line(INDENT, entry.row, frame)]

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
		rows.map((row) => row_line(INDENT, row, frame)),
	)
}

// The time column's width: the widest time any active row draws in this frame.
function time_width(header: BoardHeader): number {
	const times = (header.layout?.active ?? []).map((row) => time_of(row, header.now_ms) ?? '')

	return Math.max(0, ...times.map((time) => time.length))
}

// The legend names only the phases some row on screen draws, in the phases' own order — seven icons
// most of which no row shows would crowd out the ones that do (joshuafolkken/kit#3452).
function phase_legend(layout: BoardLayout, words: Words): Array<string> {
	const shown = new Set(run_board_layout.rows_of(layout).flatMap((row) => drawn_phases(row)))

	return run_board_phase.PHASES.filter((phase) => shown.has(phase)).map(
		(phase) => `${PHASE_ICONS[phase]} ${words[PHASE_WORDS[phase]]}`,
	)
}

// The findings' symbols, named only while the section is on screen (joshuafolkken/kit#3478).
function notes_legend(notes: ReadonlyArray<BoardNote>, words: Words): Array<string> {
	if (notes.length === 0) return []

	return [
		`${NOTES_ICON} ${words.notes}`,
		`${NOTE_ICONS.filed} ${words.filed}`,
		`${NOTE_ICONS.note} ${words.note}`,
	]
}

function legend_of(layout: BoardLayout, notes: ReadonlyArray<BoardNote>, words: Words): string {
	const legend = [
		`${STATE_ICONS.merged} ${words.merged}`,
		`${STATE_ICONS.parked} ${words.parked}`,
		`${STATE_ICONS.running} ${words.in_progress}`,
		`${STATE_ICONS.stopped} ${words.stopped}`,
		`${STATE_ICONS.waiting} ${words.waiting}`,
		`${STATE_ICONS.human} ${words.decision}`,
		`${WAITS_ICON} ${words.waits}`,
		...phase_legend(layout, words),
		`${HEADER_ICONS.cpu} ${words.cpu}`,
		`${HEADER_ICONS.memory} ${words.memory}`,
		`${HEADER_ICONS.swap} ${words.swap}`,
		`${HEADER_ICONS.ended} ${words.ended}`,
		...notes_legend(notes, words),
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

// The layout a legend is drawn for: none in a chat (joshuafolkken/kit#3456), nor before a plan is read.
function legend_layout(header: BoardHeader): BoardLayout | undefined {
	return header.form === 'chat' ? undefined : header.layout
}

// Where the legend names the symbols a note leads with its icon alone; where no legend is drawn it
// keeps the kind's word (joshuafolkken/kit#3478).
function note_text(note: BoardNote, header: BoardHeader): string {
	const { words } = header
	const kind = legend_layout(header) === undefined ? words[note.kind] : undefined
	const lead = [note_icon(note), clock_of(note.at_ms), note.issue, kind]
		.filter((part) => part !== undefined)
		.join(' ')

	return `${INDENT}${lead}${GAP}${note.text}${found_of(note, words)}`
}

// The newest few, and how many more there are, so the section never pushes the plan off the screen.
function notes_section(notes: ReadonlyArray<BoardNote>, header: BoardHeader): Array<string> {
	const { words } = header
	const shown = notes.slice(0, NOTE_LIMIT).map((note) => note_text(note, header))
	const hidden = notes.length - shown.length
	const more = hidden > 0 ? [`${INDENT}${words.more} ${String(hidden)}`] : []
	const label = legend_layout(header) === undefined ? words.notes : NOTES_ICON

	return section(label, [...shown, ...more])
}

// The command that resumes a stopped run's session, under the header where the person looks first.
function resume_lines(resume: string | undefined, words: Words): Array<string> {
	if (resume === undefined) return []

	return ['', `${STATE_ICONS.human} ${words.resume}${GAP}claude --resume ${resume}`]
}

// A chat draws no legend: the symbols are the same in every answer (joshuafolkken/kit#3456).
function legend_lines(header: BoardHeader, notes: ReadonlyArray<BoardNote>): Array<string> {
	const layout = legend_layout(header)

	if (layout === undefined) return []

	return ['', legend_of(layout, notes, header.words)]
}

function render(view: BoardView): Array<string> {
	const { header, notes } = view

	return [
		...run_board_header.header_lines(header),
		...resume_lines(view.resume, header.words),
		...plan_sections(header),
		...notes_section(notes, header),
		...legend_lines(header, notes),
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
