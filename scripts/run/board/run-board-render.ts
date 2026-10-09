import { styleText } from 'node:util'
import {
	run_board_fit,
	type FrameParts,
	type NotesPart,
	type PlanLine,
	type PlanSection,
	type RowYield,
	type TerminalSize,
	type YieldStage,
} from './run-board-fit'
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
import type { ItemState } from './run-board-status'
import { run_board_track } from './run-board-track'

// The whole `run:board` screen as lines (joshuafolkken/kit#3430) — pure, so what a person sees is tested
// apart from the terminal. The header says where the run is; the sections below it follow the plan's
// order; the findings at the bottom are what the run would otherwise have said in no chat anyone reads.
// A section is a rule rather than a heading, and the legend at the foot names the symbols, so a row
// carries only what differs between rows (joshuafolkken/kit#3444). Every word is English whatever the
// session language (joshuafolkken/kit#3486): one set of words reads the same on every board.

const { NOTES_ICON, NOTE_ICONS, PHASE_ICONS, PHASE_WORDS, STATE_ICONS, WAITS_ICON, WORDS } =
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

// The live terminal a frame is kept within, and the footer the frame ends on and gives way first
// (joshuafolkken/kit#3505); neither for a frame that is not redrawn in place.
interface FrameBounds {
	size?: TerminalSize | undefined
	footer?: ReadonlyArray<string> | undefined
}

interface BoardView extends FrameBounds {
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

// A row drawn before the plan is read has no title yet, and says so (joshuafolkken/kit#3486).
function row_title(row: BoardRow, header: BoardHeader): string | undefined {
	if (row.title !== undefined || run_board_header.is_plan_read(header)) return row.title

	return ELLIPSIS
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

// The phases a row's track draws — every one its row has passed (joshuafolkken/kit#3460) — whose newest
// leads a running row.
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

	const title = title_of(frame.header, row_title(row, frame.header))

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

// The stage each state's row gives way in when the pane is short (joshuafolkken/kit#3505).
const YIELD_STAGES: Readonly<Record<ItemState, YieldStage>> = {
	merged: 'finished',
	done: 'finished',
	waiting: 'pending',
	human: 'pending',
	parked: 'parked',
	stopped: 'parked',
	running: 'running',
}

// A running row is as old as its start; a settled one as its end, or its start where it has none.
function aged_ms(row: BoardRow): number | undefined {
	const started = row.status?.started_ms

	return row.state === 'running' ? started : (row.status?.ended_ms ?? started)
}

function yield_of(row: BoardRow): RowYield {
	return { stage: YIELD_STAGES[row.state], at_ms: aged_ms(row) }
}

// A plan line that draws one issue row, and one that draws none — a blank, a rule, an epic's own line.
function row_line(prefix: string, row: BoardRow, frame: RowFrame): PlanLine {
	const text = `${indent_of(prefix, row, frame.header)}${row_text(row, frame)}`

	return { text, row: yield_of(row) }
}

function bare(text: string): PlanLine {
	return { text, row: undefined }
}

function epic_lines(entry: Extract<WaveEntry, { kind: 'epic' }>, frame: RowFrame): Array<PlanLine> {
	const last = entry.rows.length - 1
	const children = entry.rows.map((row, index) =>
		row_line(index === last ? LAST_BRANCH : BRANCH, row, frame),
	)
	const title = title_of(frame.header, entry.title)
	const number = frame.header.link(String(entry.epic))
	const epic = title === '' ? number : `${number}${GAP}${title}`

	return [bare(`${INDENT}📁 ${epic}`), ...children]
}

function entry_lines(entry: WaveEntry, frame: RowFrame): Array<PlanLine> {
	if (entry.kind === 'row') return [row_line(INDENT, entry.row, frame)]

	return epic_lines(entry, frame)
}

function rule_of(label: string): string {
	return `${RULE_LEAD} ${label} `.padEnd(RULE_WIDTH, RULE)
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

function rows_section(
	heading: string | undefined,
	rows: ReadonlyArray<BoardRow>,
	frame: RowFrame,
): Array<PlanSection> {
	return plan_section(
		heading,
		rows.map((row) => row_line(INDENT, row, frame)),
	)
}

// The time column's width: the widest time any active row draws in this frame.
function time_width(header: BoardHeader): number {
	const times = (header.layout?.active ?? []).map((row) => time_of(row, header.now_ms) ?? '')

	return Math.max(0, ...times.map((time) => time.length))
}

// Every phase a run passes through, in the phases' own order and whatever is on screen
// (joshuafolkken/kit#3480): a row's phase moves between redraws, so a fixed line keeps each icon where
// the eye last found it. `merged` is the states' ✅. 🚀 is named though a dispatched row, its track
// still empty, leads with 🔄 — the line is the run's phases, not the marks a row draws.
const PHASE_LEGEND = run_board_phase.PHASES.filter((phase) => phase !== 'merged')
	.map((phase) => `${PHASE_ICONS[phase]} ${WORDS[PHASE_WORDS[phase]]}`)
	.join(GAP)

// The row states the legend can name, in its order, each with its word.
const STATE_LEGEND: ReadonlyArray<readonly [ItemState, keyof Words]> = [
	['merged', 'merged'],
	['parked', 'parked'],
	['done', 'done'],
	['running', 'in_progress'],
	['stopped', 'stopped'],
	['waiting', 'waiting'],
	['human', 'decision'],
]

// The states some row on screen leads with — a running row leads with its phase, so 🔄 is named only
// while a row draws it (joshuafolkken/kit#3480).
function state_legend(rows: ReadonlyArray<BoardRow>): Array<string> {
	const drawn = new Set(rows.map((row) => state_icon(row)))

	return STATE_LEGEND.filter(([state]) => drawn.has(STATE_ICONS[state])).map(
		([state, word]) => `${STATE_ICONS[state]} ${WORDS[word]}`,
	)
}

function waits_legend(rows: ReadonlyArray<BoardRow>): Array<string> {
	return rows.some((row) => row.waits.length > 0) ? [`${WAITS_ICON} ${WORDS.waits}`] : []
}

// The findings' symbols, named only while the section is on screen (joshuafolkken/kit#3478).
function notes_legend(notes: ReadonlyArray<BoardNote>): Array<string> {
	if (notes.length === 0) return []

	return [
		`${NOTES_ICON} ${WORDS.notes}`,
		`${NOTE_ICONS.filed} ${WORDS.filed}`,
		`${NOTE_ICONS.note} ${WORDS.note}`,
	]
}

// The phases on one line and what the screen draws on a second, drawn only when it names something
// (joshuafolkken/kit#3480). The header's gauges and marks read by their place, so the legend leaves them.
function legend_of(layout: BoardLayout, notes: ReadonlyArray<BoardNote>): Array<string> {
	const rows = run_board_layout.rows_of(layout)
	const shown = [...state_legend(rows), ...waits_legend(rows), ...notes_legend(notes)]
	const lines = shown.length === 0 ? [PHASE_LEGEND] : [PHASE_LEGEND, shown.join(GAP)]

	return lines.map((line) => styleText('dim', line))
}

function plan_sections(header: BoardHeader): Array<PlanSection> {
	const { layout } = header

	if (layout === undefined) return []

	const frame = { header, time_width: time_width(header) }
	const waves = layout.waves.flatMap((wave, index) =>
		plan_section(
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

function found_of(note: BoardNote): string {
	if (note.found_during === undefined) return ''

	return WORDS.found_during.split(NUMBER_PLACEHOLDER).join(note.found_during)
}

// The layout a legend is drawn for: none in a chat (joshuafolkken/kit#3456), nor before a plan is read.
function legend_layout(header: BoardHeader): BoardLayout | undefined {
	return header.form === 'chat' ? undefined : header.layout
}

// Where the legend names the symbols a note leads with its icon alone; where no legend is drawn it
// keeps the kind's word (joshuafolkken/kit#3478).
function note_text(note: BoardNote, header: BoardHeader): string {
	const kind = legend_layout(header) === undefined ? WORDS[note.kind] : undefined
	const lead = [note_icon(note), clock_of(note.at_ms), note.issue, kind]
		.filter((part) => part !== undefined)
		.join(' ')

	return `${INDENT}${lead}${GAP}${note.text}${found_of(note)}`
}

// The newest few, and how many more there are, so the section never pushes the plan off the screen.
function notes_part(notes: ReadonlyArray<BoardNote>, header: BoardHeader): NotesPart {
	const lines = notes.slice(0, NOTE_LIMIT).map((note) => note_text(note, header))
	const label = legend_layout(header) === undefined ? WORDS.notes : NOTES_ICON

	return { head: heading_lines(label), lines, hidden: notes.length - lines.length }
}

// The command that resumes a stopped run's session, under the header where the person looks first.
function resume_lines(resume: string | undefined): Array<string> {
	if (resume === undefined) return []

	return ['', `${STATE_ICONS.human} ${WORDS.resume}${GAP}claude --resume ${resume}`]
}

// A chat draws no legend: the symbols are the same in every answer (joshuafolkken/kit#3456).
function legend_lines(header: BoardHeader, notes: ReadonlyArray<BoardNote>): Array<string> {
	const layout = legend_layout(header)

	if (layout === undefined) return []

	return ['', ...legend_of(layout, notes)]
}

// A live frame is kept within its terminal (joshuafolkken/kit#3486); any other is drawn whole.
function bounded(parts: FrameParts, bounds: FrameBounds): Array<string> {
	const { size } = bounds

	return size === undefined ? run_board_fit.whole(parts) : run_board_fit.fit(parts, size)
}

function render(view: BoardView): Array<string> {
	const { header, notes } = view
	const above = [
		...run_board_header.header_lines(header),
		...resume_lines(view.resume),
		...run_board_header.idle_lines(header),
	]
	const parts = {
		above,
		plan: plan_sections(header),
		notes: notes_part(notes, header),
		legend: legend_lines(header, notes),
		footer: view.footer ?? [],
	}

	return bounded(parts, view)
}

function render_no_run(now_ms: number, bounds: FrameBounds = {}): Array<string> {
	const above = [`■ backlogrun${GAP}${WORDS.no_run}${GAP}${clock_of(now_ms)}`]
	const notes = { head: [], lines: [], hidden: 0 }

	return bounded({ above, plan: [], notes, legend: [], footer: bounds.footer ?? [] }, bounds)
}

const run_board_render = {
	NOTE_LIMIT,
	TITLE_LIMIT,
	render,
	render_no_run,
}

export { run_board_render }
export type { BoardView, FrameBounds }
