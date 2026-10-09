import { styleText } from 'node:util'
import { run_board_fit, type PlanLine, type TerminalSize } from './run-board-fit'
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
import { run_board_render_notes } from './run-board-render-notes'
import type { ItemState } from './run-board-status'
import { run_board_track } from './run-board-track'
import type { LaneUsages } from './run-board-usage'
import { run_board_usage_text } from './run-board-usage-text'

// The whole `run:board` screen as lines (joshuafolkken/kit#3430) — pure, so what a person sees is tested
// apart from the terminal. The header says where the run is; the sections below it follow the plan's
// order; the findings at the bottom are what the run would otherwise have said in no chat anyone reads.
// A section is a rule rather than a heading, and the legend at the foot names the symbols, so a row
// carries only what differs between rows (joshuafolkken/kit#3444). Every word is English whatever the
// session language (joshuafolkken/kit#3486): one set of words reads the same on every board.

const { NOTES_ICON, PHASE_ICONS, PHASE_WORDS, STATE_ICONS, WAITS_ICON, WORDS } = run_board_labels
const { clock_of, elapsed_of } = run_board_labels
const { NOTE_LIMIT } = run_board_render_notes
// The track is a fixed fourteen columns where the gauge and the phase's name took up to twenty-two, so
// the title takes the columns it freed and a row is no wider (joshuafolkken/kit#3460).
const TITLE_LIMIT = 48
const ELLIPSIS = '…'
const GAP = '  '
const INDENT = '  '
const BRANCH = '     ├ '
const LAST_BRANCH = '     └ '
const RULE = '─'
const RULE_LEAD = `${RULE}${RULE}`
const RULE_WIDTH = 50

interface BoardView {
	header: BoardHeader
	notes: ReadonlyArray<BoardNote>
	// The session a stopped run resumes from (joshuafolkken/kit#3437).
	resume?: string | undefined
	// The live terminal the frame is kept within; none for a frame that is not redrawn in place.
	size?: TerminalSize | undefined
}

// What every row of one frame is drawn with: the header, how wide the time column is, so a
// three-digit `125:30` and a `00:42` end in the same column, and each lane's usage where its column is
// drawn (joshuafolkken/kit#3489).
interface RowFrame {
	header: BoardHeader
	time_width: number
	usages: LaneUsages | undefined
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

// A running row's CPU and memory (joshuafolkken/kit#3489); a settled lane runs no process.
function usage_of(row: BoardRow, usages: LaneUsages | undefined): string | undefined {
	if (row.state !== 'running') return undefined

	return run_board_usage_text.text_of(usages?.get(row.number))
}

// Every row carries its state's icon, a waiting one ⏳ too (joshuafolkken/kit#3450).
function row_text(row: BoardRow, frame: RowFrame): string {
	const { header } = frame
	const lead = `${state_icon(row)} ${header.link(String(row.number))}`
	const usage = usage_of(row, frame.usages)
	const parts = [lead, ...timed_parts(row, frame), usage, waits_of(row, header)]

	return parts.filter((part) => part !== undefined && part !== '').join(GAP)
}

// A plan line that draws one issue row, and one that draws none — a blank, a rule, an epic's own line.
function row_line(prefix: string, row: BoardRow, frame: RowFrame): PlanLine {
	return { text: `${indent_of(prefix, row, frame.header)}${row_text(row, frame)}`, rows: 1 }
}

function bare(text: string): PlanLine {
	return { text, rows: 0 }
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

function section(heading: string | undefined, lines: ReadonlyArray<string>): Array<string> {
	if (lines.length === 0) return []

	return [...heading_lines(heading), ...lines]
}

function plan_section(
	heading: string | undefined,
	lines: ReadonlyArray<PlanLine>,
): Array<PlanLine> {
	if (lines.length === 0) return []

	return [...heading_lines(heading).map((line) => bare(line)), ...lines]
}

function rows_section(
	heading: string | undefined,
	rows: ReadonlyArray<BoardRow>,
	frame: RowFrame,
): Array<PlanLine> {
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
// the eye last found it. `merged` is the states' ✅.
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

// The states some row on screen leads with (`drawn`) — a running row leads with its phase, so 🔄 is
// named only while a row draws it (joshuafolkken/kit#3480).
function state_legend(drawn: ReadonlySet<string>): Array<string> {
	return STATE_LEGEND.filter(([state]) => drawn.has(STATE_ICONS[state])).map(
		([state, word]) => `${STATE_ICONS[state]} ${WORDS[word]}`,
	)
}

function waits_legend(rows: ReadonlyArray<BoardRow>): Array<string> {
	return rows.some((row) => row.waits.length > 0) ? [`${WAITS_ICON} ${WORDS.waits}`] : []
}

// The phases on one line and what the screen draws on a second, drawn only when it names something
// (joshuafolkken/kit#3480). The header's gauges and marks read by their place, so the legend leaves them.
function legend_of(layout: BoardLayout, notes: ReadonlyArray<BoardNote>): Array<string> {
	const rows = run_board_layout.rows_of(layout)
	const drawn = new Set(rows.map((row) => state_icon(row)))
	const notes_part = run_board_render_notes.notes_legend(notes, drawn)
	const shown = [...state_legend(drawn), ...waits_legend(rows), ...notes_part]
	const lines = shown.length === 0 ? [PHASE_LEGEND] : [PHASE_LEGEND, shown.join(GAP)]

	return lines.map((line) => styleText('dim', line))
}

// Whether every running row still fits one terminal line with its usage column — measured as the
// deepest, an epic's child — where a frame is kept within a terminal (joshuafolkken/kit#3486).
function is_usage_fitting(
	layout: BoardLayout,
	frame: RowFrame,
	size: TerminalSize | undefined,
): boolean {
	if (size === undefined) return true

	return run_board_layout
		.rows_of(layout)
		.filter((row) => row.state === 'running')
		.every((row) => run_board_fit.height_of(`${BRANCH}${row_text(row, frame)}`, size.columns) === 1)
}

// The usage column is drawn on every running row or on none (joshuafolkken/kit#3489): a pane too
// narrow for it on any row, and a chat, draw it on none.
function frame_of(
	header: BoardHeader,
	layout: BoardLayout,
	size: TerminalSize | undefined,
): RowFrame {
	const usages = header.form === 'chat' ? undefined : header.usages
	const frame = { header, time_width: time_width(header), usages }

	return is_usage_fitting(layout, frame, size) ? frame : { ...frame, usages: undefined }
}

function plan_sections(header: BoardHeader, size: TerminalSize | undefined): Array<PlanLine> {
	const { layout } = header

	if (layout === undefined) return []

	const frame = frame_of(header, layout, size)
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

// The layout a legend is drawn for: none in a chat (joshuafolkken/kit#3456), nor before a plan is read.
function legend_layout(header: BoardHeader): BoardLayout | undefined {
	return header.form === 'chat' ? undefined : header.layout
}

// The findings under a rule, led by 📌 where a legend names it and by its word where none does.
function notes_section(notes: ReadonlyArray<BoardNote>, header: BoardHeader): Array<string> {
	const has_legend = legend_layout(header) !== undefined
	const label = has_legend ? NOTES_ICON : WORDS.notes

	return section(label, run_board_render_notes.note_lines(notes, has_legend))
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
function render(view: BoardView): Array<string> {
	const { header, notes, size } = view
	const above = [
		...run_board_header.header_lines(header),
		...resume_lines(view.resume),
		...run_board_header.idle_lines(header),
	]
	const parts = {
		above,
		plan: plan_sections(header, size),
		below: [...notes_section(notes, header), ...legend_lines(header, notes)],
	}

	if (size === undefined) return [...above, ...parts.plan.map((line) => line.text), ...parts.below]

	return run_board_fit.fit(parts, size)
}

function render_no_run(now_ms: number): Array<string> {
	return [`■ backlogrun${GAP}${WORDS.no_run}${GAP}${clock_of(now_ms)}`]
}

const run_board_render = {
	NOTE_LIMIT,
	TITLE_LIMIT,
	render,
	render_no_run,
}

export { run_board_render }
export type { BoardView }
