import {
	run_board_fit,
	type FrameParts,
	type NotesPart,
	type PlanLine,
	type PlanSection,
	type TerminalSize,
} from './run-board-fit'
import { run_board_fresh } from './run-board-fresh'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import {
	run_board_layout,
	type BoardLayout,
	type BoardRow,
	type WaveEntry,
} from './run-board-layout'
import type { Link } from './run-board-link'
import type { BoardNote } from './run-board-notes'
import { run_board_render_checks } from './run-board-render-checks'
import { run_board_render_legend } from './run-board-render-legend'
import { run_board_render_notes } from './run-board-render-notes'
import { run_board_render_slot, type UsageSlot } from './run-board-render-slot'
import { run_board_render_tail } from './run-board-render-tail'
import { run_board_render_thanks } from './run-board-render-thanks'
import { run_board_render_title } from './run-board-render-title'
import { run_board_render_waits } from './run-board-render-waits'
import { run_board_row_yield } from './run-board-row-yield'
import type { Thanks } from './run-board-thanks-csv'

// The whole `run:board` screen as lines — pure, so what a person sees is tested apart from the
// terminal. The header says where the run is; the sections below it follow the plan's order; the
// findings at the bottom are what the run would otherwise have said in no chat anyone reads. A section
// is a rule rather than a heading, and the legend at the foot names the symbols, so a row carries only
// what differs between rows. Every word is English whatever the session language: one set of words
// reads the same on every board.

const { FILED_KIND_ICONS, KIND_BLANK, NOTES_ICON, NOW_ICONS, PHASE_ICONS, STATE_ICONS } =
	run_board_labels
const { WAITS_ICON, WORDS } = run_board_labels
const { clock_of, span_of } = run_board_labels
const { NOTE_LIMIT } = run_board_render_notes
const { cell_of, column_width, slot_of, usage_slot } = run_board_render_slot
const { ELLIPSIS, TITLE_LIMIT, fitted, reason_text, title_of } = run_board_render_title
const { padded } = run_board_fresh
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
	// The reviewers thanked above the legend, and the link a name with a page is wrapped in.
	thanks?: Thanks | undefined
	link?: Link | undefined
}

// What every row of one frame is drawn with: the header, how wide the time column is, so a
// `2°05′30″` and a `42″` end in the same column, and each lane's usage where its column is drawn, with
// the column's width.
interface RowFrame {
	header: BoardHeader
	time_width: number
	usage: UsageSlot | undefined
	slot_width: number
	// The columns a row's title is cut to: the title column's, or fewer where a row gives some up.
	title_limit: number
	// The pane's width where the frame is kept within one.
	columns: number | undefined
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

	return elapsed === undefined ? undefined : span_of(elapsed)
}

function waits_of(row: BoardRow, header: BoardHeader): string | undefined {
	if (row.waits.length === 0) return undefined

	return `${WAITS_ICON} ${row.waits.map((reference) => header.link(reference)).join(', ')}`
}

// A running row's part that changed at `at_ms`, emphasized while fresh (`run-board-fresh.ts`) — its
// start and its phase; a settled row's are long past.
function running_fresh(
	row: BoardRow,
	text: string,
	at_ms: number | undefined,
	header: BoardHeader,
): string {
	return row.state === 'running' ? run_board_fresh.since(text, at_ms, header) : text
}

// The title padded to the title column and the time to the time column — blanks where a row has none —
// so the times form one column, and what follows them starts in one column on every row but a waiting
// one, whose title is not padded.
function timed_parts(row: BoardRow, frame: RowFrame): Array<string> {
	const title = title_of(row_title(row, frame.header), frame.title_limit)

	if (row.state === 'waiting') return [title]

	const time = time_of(row, frame.header.now_ms) ?? ''
	const fresh = running_fresh(row, time, row.status?.started_ms, frame.header)

	return [title.padEnd(frame.title_limit), padded(time, frame.time_width, fresh)]
}

// A running row leads with the icon of the phase it is in now — the last its track reached — and
// with 🔄 while it has reached none yet.
function state_icon(row: BoardRow): string {
	const current = row.state === 'running' ? row.status?.track?.at(-1) : undefined

	return current === undefined ? STATE_ICONS[row.state] : PHASE_ICONS[current]
}

// A running row turns the spinner in the first column of its indent where the header has one, so its
// title starts in the same column as every other row's.
function indent_of(prefix: string, row: BoardRow, header: BoardHeader): string {
	if (row.state !== 'running' || header.spinner === undefined) return prefix

	return `${header.spinner}${prefix.slice(1)}`
}

// A row's usage column as drawn: a settled row's finish time emphasized while it is fresh.
function slot_text(row: BoardRow, usage: UsageSlot, header: BoardHeader): string | undefined {
	const slot = slot_of(row, usage, header.now_ms)
	const ended = row.state === 'running' ? undefined : row.status?.ended_ms

	return slot === undefined ? slot : run_board_fresh.since(slot, ended, header)
}

// A row's usage column where the frame draws one, padded to one width on every row so every tail
// starts in one column. A plan row the run has not touched draws blanks in its place.
function cell_text(row: BoardRow, frame: RowFrame): string | undefined {
	const { usage, slot_width } = frame

	if (usage === undefined || slot_width === 0) return undefined
	if (row.status === undefined) return ' '.repeat(slot_width)

	return cell_of(slot_text(row, usage, frame.header), slot_width)
}

function joined(parts: ReadonlyArray<string | undefined>): string {
	return parts.filter((part) => part !== undefined && part !== '').join(GAP)
}

// The release kind's icon between the number and the title, one space either side; a row with no title
// ends at its icon, so what follows keeps its usual gap.
function lead_of(row: BoardRow, header: BoardHeader, title: string): string {
	const kind = row.kind === undefined ? KIND_BLANK : FILED_KIND_ICONS[row.kind]
	const icon = running_fresh(row, state_icon(row), row.status?.phase_ms, header)
	const lead = `${icon} ${header.link(String(row.number))} ${kind}`

	return title === '' ? lead : `${lead} ${title}`
}

// A row up to its usage column — the columns that stay where they are on every row. A waiting row has
// no time and no usage to line up, so it ends at its title and what it waits on follows two blanks on.
function head_text(row: BoardRow, frame: RowFrame): string {
	const [title = '', time] = timed_parts(row, frame)
	const lead = lead_of(row, frame.header, title)

	if (row.state === 'waiting') return lead

	return joined([lead, time, cell_text(row, frame)])
}

// Every row carries its state's icon, a waiting one ⏳ too; a running row ends on its tail
// (`run-board-render-tail.ts`), and a row with nothing after its padded columns ends where its text does.
function row_text(row: BoardRow, frame: RowFrame): string {
	const { header } = frame
	const tail = run_board_render_tail.tail_of(row, header)
	const notes = [waits_of(row, header), reason_text(row, header.now_ms)]

	return joined([head_text(row, frame), ...tail, ...notes]).trimEnd()
}

// A plan line that draws one issue row, and one that draws none — a blank, a rule, an epic's own line.
function row_line(prefix: string, row: BoardRow, frame: RowFrame): PlanLine {
	const indent = indent_of(prefix, row, frame.header)
	const text = fitted(
		row,
		frame.columns,
		(title_limit) => `${indent}${row_text(row, { ...frame, title_limit })}`,
	)

	return { text, row: run_board_row_yield.yield_of(row) }
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
// child — where a frame is kept within a terminal. The tail and the notes after it are left out: a
// row's reason makes room for itself, so one long reason would otherwise take the column off every row.
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
		title_limit: TITLE_LIMIT,
		columns: size?.columns,
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

// The activity kinds the legend names: the header's estimated finish where it draws one
// (joshuafolkken/kit#4044) and its third line's, 🔧 where a row's tail draws it, and a followup row's
// checks (joshuafolkken/kit#3770).
function activity_named(header: BoardHeader, rows: ReadonlyArray<BoardRow>): Array<string> {
	const legends = [run_board_header.estimate_legend(header), run_board_header.now_legend(header)]
	const is_drawn = rows.some((row) => run_board_render_tail.is_operation_drawn(row, header))
	const operation = is_drawn ? [`${NOW_ICONS.operation} ${WORDS.operation}`] : []
	const is_checks = rows.some((row) => run_board_render_tail.is_checks_drawn(row, header))
	const checks = is_checks ? run_board_render_checks.LEGEND : []

	return [...legends.filter((legend) => legend !== undefined), ...operation, ...checks]
}

// No legend is drawn before a plan is read: there are no rows whose symbols it would name.
function legend_lines(header: BoardHeader, notes: ReadonlyArray<BoardNote>): Array<string> {
	const { layout } = header

	if (layout === undefined) return []

	const rows = run_board_layout.rows_of(layout)
	const drawn = new Set(rows.map((row) => state_icon(row)))
	const named = activity_named(header, rows)

	return ['', ...run_board_render_legend.legend_of(rows, drawn, notes, named)]
}

// Names with no link where no terminal opens one: a frame with no `link` draws them plain.
function thanks_part(view: BoardView): Array<string> {
	const link = view.link ?? ((text: string): string => text)

	return run_board_render_thanks.thanks_lines(view.thanks ?? [], link, view.size?.columns)
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
		...run_board_render_waits.wait_lines(header.budget_waits, header.link),
		...resume_lines(view.resume),
	]
	const parts = {
		above,
		plan: plan_sections(header, view.size),
		notes: notes_part(notes, header),
		thanks: thanks_part(view),
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
