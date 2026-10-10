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
import { run_board_labels } from './run-board-labels'
import {
	run_board_layout,
	type BoardLayout,
	type BoardRow,
	type WaveEntry,
} from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import type { Phase } from './run-board-phase'
import { run_board_render_legend } from './run-board-render-legend'
import { run_board_render_notes } from './run-board-render-notes'
import { run_board_render_slot, type UsageSlot } from './run-board-render-slot'
import type { ItemState } from './run-board-status'
import { run_board_track } from './run-board-track'

// The whole `run:board` screen as lines — pure, so what a person sees is tested apart from the
// terminal. The header says where the run is; the sections below it follow the plan's order; the
// findings at the bottom are what the run would otherwise have said in no chat anyone reads. A section
// is a rule rather than a heading, and the legend at the foot names the symbols, so a row carries only
// what differs between rows. Every word is English whatever the session language: one set of words
// reads the same on every board.

const { FILED_KIND_ICONS, KIND_BLANK, NOTES_ICON, PHASE_ICONS, STATE_ICONS, WAITS_ICON, WORDS } =
	run_board_labels
const { clock_of, elapsed_of } = run_board_labels
const { NOTE_LIMIT } = run_board_render_notes
const { cell_of, column_width, slot_of, usage_slot } = run_board_render_slot
// The columns a terminal row gives its title: a longer one is cut to an ellipsis.
const TITLE_LIMIT = 48
const ELLIPSIS = '…'
const GAP = '  '
const INDENT = '  '
const BRANCH = '     ├ '
const LAST_BRANCH = '     └ '
const RULE = '─'
const RULE_LEAD = `${RULE}${RULE}`
const RULE_WIDTH = 50

// The live terminal a frame is kept within, and the footer the frame ends on and gives way first;
// neither for a frame that is not redrawn in place.
interface FrameBounds {
	size?: TerminalSize | undefined
	footer?: ReadonlyArray<string> | undefined
}

interface BoardView extends FrameBounds {
	header: BoardHeader
	notes: ReadonlyArray<BoardNote>
	// The session a stopped run resumes from.
	resume?: string | undefined
}

// What every row of one frame is drawn with: the header, how wide the time column is, so a three-digit
// `125:30` and a `00:42` end in the same column, and each lane's usage where its column is drawn, with
// the column's width.
interface RowFrame {
	header: BoardHeader
	time_width: number
	usage: UsageSlot | undefined
	slot_width: number
}

// A title cut to the title column, so every time after it starts in one column.
function title_of(title = ''): string {
	return title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT - 1)}${ELLIPSIS}` : title
}

// A row drawn before the plan is read has no title yet, and says so.
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

// The phases a row's track draws — every one the child passed while running, kept once it settles.
function drawn_phases(row: BoardRow): ReadonlyArray<Phase> {
	return row.status?.track ?? []
}

// A row's phases as its track, drawn last: it grows with every round, so the
// columns before it stay where they are whatever its length. A settled row's ends on its state icon.
function track_text(row: BoardRow): string | undefined {
	const phases = drawn_phases(row)

	return phases.length === 0 ? undefined : run_board_track.track_of(phases, row.state)
}

function waits_of(row: BoardRow, header: BoardHeader): string | undefined {
	if (row.waits.length === 0) return undefined

	return `${WAITS_ICON} ${row.waits.map((reference) => header.link(reference)).join(', ')}`
}

// The title is padded to the title column where a time or the usage column follows it, so the times
// form one column; a row with no time draws blanks in its place before the usage column.
function timed_parts(
	row: BoardRow,
	frame: RowFrame,
	is_slotted: boolean,
): Array<string | undefined> {
	const time = time_of(row, frame.header.now_ms)

	const title = title_of(row_title(row, frame.header))

	if (time === undefined && !is_slotted) return [title]

	return [title.padEnd(TITLE_LIMIT), (time ?? '').padStart(frame.time_width)]
}

// A running row leads with the icon of the phase it is in now — the rightmost
// icon of its track — and with 🔄 while its track draws none yet.
function state_icon(row: BoardRow): string {
	const current = row.state === 'running' ? drawn_phases(row).at(-1) : undefined

	return current === undefined ? STATE_ICONS[row.state] : PHASE_ICONS[current]
}

// A running row turns the spinner in the first column of its indent where the header has one, so its
// title starts in the same column as every other row's.
function indent_of(prefix: string, row: BoardRow, header: BoardHeader): string {
	if (row.state !== 'running' || header.spinner === undefined) return prefix

	return `${header.spinner}${prefix.slice(1)}`
}

// A row's usage column where the frame draws one, padded to one width on every row so every track
// starts in one column. A plan row the run has not touched has no time, usage or track to align, so it
// draws none and what it waits on stays beside its title.
function cell_text(row: BoardRow, frame: RowFrame): string | undefined {
	const { usage, slot_width } = frame

	if (usage === undefined || slot_width === 0 || row.status === undefined) return undefined

	return cell_of(slot_of(row, usage, frame.header.now_ms), slot_width)
}

function joined(parts: ReadonlyArray<string | undefined>): string {
	return parts.filter((part) => part !== undefined && part !== '').join(GAP)
}

// The release kind's icon between the number and the title, one space either side; a row with no title
// ends at its icon, so what follows keeps its usual gap.
function lead_of(row: BoardRow, header: BoardHeader, title: string): string {
	const kind = row.kind === undefined ? KIND_BLANK : FILED_KIND_ICONS[row.kind]
	const lead = `${state_icon(row)} ${header.link(String(row.number))} ${kind}`

	return title === '' ? lead : `${lead} ${title}`
}

// A row up to its usage column — the columns that stay where they are whatever the track's length.
function head_text(row: BoardRow, frame: RowFrame): string {
	const cell = cell_text(row, frame)
	const [title = '', ...time] = timed_parts(row, frame, cell !== undefined)

	return joined([lead_of(row, frame.header, title), ...time, cell])
}

// Every row carries its state's icon, a waiting one ⏳ too; a row with nothing
// after its padded columns ends where its text does.
function row_text(row: BoardRow, frame: RowFrame): string {
	return joined([head_text(row, frame), track_text(row), waits_of(row, frame.header)]).trimEnd()
}

// The stage each state's row gives way in when the pane is short.
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
	const title = title_of(entry.title)
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

// Whether every row's usage column still fits one terminal line — measured as the deepest, an epic's
// child — where a frame is kept within a terminal. The track after it is left out: it grows without
// bound, so one long history would otherwise take the usage column off every row.
function is_usage_fitting(
	rows: ReadonlyArray<BoardRow>,
	frame: RowFrame,
	size: TerminalSize | undefined,
): boolean {
	if (size === undefined) return true

	return rows.every(
		(row) => run_board_fit.height_of(`${BRANCH}${head_text(row, frame)}`, size.columns) === 1,
	)
}

// The usage column is drawn on every row or on none: a pane too narrow for it on any row draws it on
// none — a finish time with it.
function frame_of(
	header: BoardHeader,
	layout: BoardLayout,
	size: TerminalSize | undefined,
): RowFrame {
	const rows = run_board_layout.rows_of(layout)
	const usage = header.usages === undefined ? undefined : usage_slot(rows, header.usages)
	const frame = {
		header,
		time_width: time_width(header),
		usage,
		slot_width: usage === undefined ? 0 : column_width(rows, usage, header.now_ms),
	}

	return is_usage_fitting(rows, frame, size) ? frame : { ...frame, usage: undefined }
}

function plan_sections(header: BoardHeader, size: TerminalSize | undefined): Array<PlanSection> {
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

// The findings under a rule, led by 📌 where a legend names it and by its word where none does, and how
// many more there are, so the section never pushes the plan off the screen.
function notes_part(notes: ReadonlyArray<BoardNote>, header: BoardHeader): NotesPart {
	const has_legend = header.layout !== undefined
	const lines = run_board_render_notes.note_lines(notes, has_legend, header.link)
	const label = has_legend ? NOTES_ICON : WORDS.notes

	return { head: heading_lines(label), lines, hidden: notes.length - lines.length }
}

// The command that resumes a stopped run's session, under the header where the person looks first.
function resume_lines(resume: string | undefined): Array<string> {
	if (resume === undefined) return []

	return ['', `${STATE_ICONS.human} ${WORDS.resume}${GAP}claude --resume ${resume}`]
}

// No legend is drawn before a plan is read: there are no rows whose symbols it would name.
function legend_lines(header: BoardHeader, notes: ReadonlyArray<BoardNote>): Array<string> {
	const { layout } = header

	if (layout === undefined) return []

	const rows = run_board_layout.rows_of(layout)
	const drawn = new Set(rows.map((row) => state_icon(row)))

	return ['', ...run_board_render_legend.legend_of(rows, drawn, notes)]
}

// A live frame is kept within its terminal; any other is drawn whole.
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
		plan: plan_sections(header, view.size),
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
