import {
	run_board_fit,
	type FrameParts,
	type PlanLine,
	type PlanSection,
	type TerminalSize,
	type YieldStage,
} from './run-board-fit'
import { run_board_fold, type FrameBounds } from './run-board-fold'
import { run_board_fresh } from './run-board-fresh'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import {
	run_board_layout,
	type BoardLayout,
	type BoardRow,
	type QueuedEntry,
} from './run-board-layout'
import type { Link } from './run-board-link'
import { run_board_notes, type BoardNote } from './run-board-notes'
import { run_board_render_foot } from './run-board-render-foot'
import { run_board_render_icon } from './run-board-render-icon'
import { run_board_render_lanes, type LaneCells } from './run-board-render-lanes'
import { run_board_render_notes } from './run-board-render-notes'
import { run_board_render_processes } from './run-board-render-processes'
import { run_board_render_section } from './run-board-render-section'
import { run_board_render_slot } from './run-board-render-slot'
import { run_board_render_tail } from './run-board-render-tail'
import { run_board_render_time } from './run-board-render-time'
import { run_board_render_title, type RowCut, type RowFit } from './run-board-render-title'
import { run_board_row_yield } from './run-board-row-yield'
import type { Thanks } from './run-board-thanks-csv'

// The whole `run:board` screen as lines — pure, so what a person sees is tested apart from the
// terminal. The header says where the run is; under it the run's own rows, then the ones waiting on a
// person's decision, then the findings — what the run would otherwise have said in no chat anyone
// reads — and the plan's rest in its order. A section is a rule rather than a heading, and the legend
// at the foot names the symbols, so a row carries only what differs between rows. Every word is
// English whatever the session language: one set of words reads the same on every board.

const { FILED_KIND_ICONS, KIND_BLANK, STATE_ICONS, WAITS_ICON, WORDS, clock_of } = run_board_labels
const { time_of, time_width } = run_board_render_time
const { state_icon } = run_board_render_icon
const { NOTE_LIMIT } = run_board_render_notes
const { cell_of, column_width, slot_of } = run_board_render_slot
const { lane_cells_of, lanes_section, number_text } = run_board_render_lanes
const { ELLIPSIS, TITLE_LIMIT, WHOLE, fitted, reason_text, row_overrun, title_of } =
	run_board_render_title
const { padded } = run_board_fresh
const { legend_lines, resume_lines, thanks_part } = run_board_render_foot
const GAP = '  '
const INDENT = '  '
const FILED_LEAD = `${run_board_labels.FILED_RUN_MARK} `
const BRANCH = '     ├ '
const LAST_BRANCH = '     └ '
const { done_section, keyed, plan_section } = run_board_render_section
const { bounded } = run_board_fold

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
// `2°05′30″` and a `42″` end in the same column, the finish-time column's width — 0 where it is not
// drawn — and the lane cells after a row's number where its section draws them.
interface RowFrame {
	header: BoardHeader
	time_width: number
	slot_width: number
	cells?: LaneCells | undefined
	// The columns a row's title is cut to: the title column's, or fewer where a row gives some up.
	title_limit: number
	// The columns cut off the end of a row's reason, where its title alone could not give up enough.
	reason_cut: number
	// The pane's width where the frame is kept within one.
	columns: number | undefined
	// The issues the run filed, whose rows lead their title with ✚.
	filed: ReadonlySet<number>
	// The columns a lane row that draws a tail gives up with every other such row.
	shared?: number | undefined
}

// A row drawn before the plan is read has no title yet, and says so.
function row_title(row: BoardRow, header: BoardHeader): string | undefined {
	if (row.title !== undefined || run_board_header.is_plan_read(header)) return row.title

	return ELLIPSIS
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

// A row the run filed leads its title with ✚ (joshuafolkken/kit#4099), cut by as many columns, so every
// column after it stays where an unmarked row has it.
function title_text(row: BoardRow, frame: RowFrame): string {
	const title = row_title(row, frame.header)

	if (!frame.filed.has(row.number)) return title_of(title, frame.title_limit)

	return `${FILED_LEAD}${title_of(title, frame.title_limit - FILED_LEAD.length)}`
}

// The title padded to the title column and the time to the time column — blanks where a row has none —
// so the times form one column, and what follows them starts in one column on every row but a waiting
// one, whose title is not padded.
function timed_parts(row: BoardRow, frame: RowFrame): Array<string> {
	const title = title_text(row, frame)

	if (row.state === 'waiting') return [title]

	const time = time_of(row, frame.header.now_ms) ?? ''
	const fresh = running_fresh(row, time, row.status?.started_ms, frame.header)

	return [title.padEnd(frame.title_limit), padded(time, frame.time_width, fresh)]
}

// A running row turns the spinner in the first column of its indent where the header has one, so its
// title starts in the same column as every other row's.
function indent_of(prefix: string, row: BoardRow, header: BoardHeader): string {
	if (row.state !== 'running' || header.spinner === undefined) return prefix

	return `${header.spinner}${prefix.slice(1)}`
}

// A row's finish-time column as drawn: a settled row's finish time emphasized while it is fresh.
function slot_text(row: BoardRow, header: BoardHeader): string | undefined {
	const slot = slot_of(row, header.now_ms)

	return slot === undefined ? slot : run_board_fresh.since(slot, row.status?.ended_ms, header)
}

// A parked row has no finish time — a decision park drawn 🙋 among them.
function is_parked(row: BoardRow): boolean {
	return row.status?.state === 'parked'
}

// A row's finish-time column where the frame draws one, padded to one width so every finish time and
// what follows it start in one column. A plan row the run has not touched draws blanks in its place; a
// parked row draws none, and its reason follows its time; a row that ends on a tail draws none either,
// its tail following its time (joshuafolkken/kit#4217).
function cell_text(row: BoardRow, frame: RowFrame): string | undefined {
	const { slot_width } = frame

	if (slot_width === 0 || is_parked(row) || run_board_render_tail.is_tailed(row)) return undefined
	if (row.status === undefined) return ' '.repeat(slot_width)

	return cell_of(slot_text(row, frame.header), slot_width)
}

function joined(parts: ReadonlyArray<string | undefined>): string {
	return parts.filter((part) => part !== undefined && part !== '').join(GAP)
}

// The release kind's icon between the number — and its lane cells, where drawn — and the title, one
// space either side; a row with no title ends at its icon, so what follows keeps its usual gap.
function lead_of(row: BoardRow, frame: RowFrame, title: string): string {
	const { header } = frame
	const kind = row.kind === undefined ? KIND_BLANK : FILED_KIND_ICONS[row.kind]
	const icon = running_fresh(row, state_icon(row, header), row.status?.phase_ms, header)
	const lead = `${icon} ${number_text(row, frame.cells, header.link)} ${kind}`

	return title === '' ? lead : `${lead} ${title}`
}

// A row up to its usage column — the columns that stay where they are on every row. A waiting row has
// no time and no usage to line up, so it ends at its title and what it waits on follows two blanks on.
function head_text(row: BoardRow, frame: RowFrame): string {
	const [title = '', time] = timed_parts(row, frame)
	const lead = lead_of(row, frame, title)

	if (row.state === 'waiting') return lead

	return joined([lead, time, cell_text(row, frame)])
}

// Every row carries its state's icon, a waiting one ⏳ too; a running row ends on its tail
// (`run-board-render-tail.ts`), and a row with nothing after its padded columns ends where its text does.
function row_text(row: BoardRow, frame: RowFrame): string {
	const { header } = frame
	const tail = run_board_render_tail.tail_of(row, header)
	const notes = [waits_of(row, header), reason_text(row, header.now_ms, frame.reason_cut)]

	return joined([head_text(row, frame), ...tail, ...notes]).trimEnd()
}

// A row drawn whole or cut, after its indent.
function row_draw(indent: string, row: BoardRow, frame: RowFrame): (cut: RowCut) => string {
	return (cut) => `${indent}${row_text(row, { ...frame, ...cut })}`
}

// A row drawn with lane cells keeps its head on one line: `is_usage_fitting` measures no cells, so its
// title gives up their columns where the pane is narrow. A row that draws a tail keeps its whole line,
// giving up the columns its section's rows give up together (joshuafolkken/kit#4226).
function row_fit(indent: string, row: BoardRow, frame: RowFrame): RowFit {
	const is_line_kept = run_board_render_tail.tail_of(row, frame.header).length > 0

	return {
		is_line_kept,
		lead: frame.filed.has(row.number) ? FILED_LEAD.length : 0,
		head: (cut) => `${indent}${head_text(row, { ...frame, ...cut })}`,
		is_head_kept: frame.cells !== undefined,
		shared: is_line_kept ? frame.shared : undefined,
	}
}

// A plan line that draws one issue row, and one that draws none — a blank, a rule, an epic's own line.
function row_line(prefix: string, row: BoardRow, frame: RowFrame, stage?: YieldStage): PlanLine {
	const indent = indent_of(prefix, row, frame.header)
	const fit = row_fit(indent, row, frame)
	const text = fitted(row, frame.columns, row_draw(indent, row, frame), fit)

	return { text, row: run_board_row_yield.yield_of(row, stage) }
}

// The most columns a lane row that draws a tail runs past the pane, which every such row gives up, so
// their titles end in one column and the tails after them start in one.
function shared_overrun(rows: ReadonlyArray<BoardRow>, frame: RowFrame): number {
	const overruns = rows.map((row) => {
		const indent = indent_of(INDENT, row, frame.header)
		const fit = row_fit(indent, row, frame)

		return fit.is_line_kept === true
			? row_overrun(row, frame.columns, row_draw(indent, row, frame), fit)
			: 0
	})

	return Math.max(0, ...overruns)
}

function bare(text: string): PlanLine {
	return { text, row: undefined }
}

function epic_lines(
	entry: Extract<QueuedEntry, { kind: 'epic' }>,
	frame: RowFrame,
): Array<PlanLine> {
	const last = entry.rows.length - 1
	const children = entry.rows.map((row, index) =>
		row_line(index === last ? LAST_BRANCH : BRANCH, row, frame),
	)
	const title = title_of(entry.title)
	const number = frame.header.link(String(entry.epic))
	const epic = title === '' ? number : `${number}${GAP}${title}`

	return [bare(`${INDENT}📁 ${epic}`), ...children]
}

function entry_lines(entry: QueuedEntry, frame: RowFrame): Array<PlanLine> {
	if (entry.kind === 'row') return [row_line(INDENT, entry.row, frame)]

	return epic_lines(entry, frame)
}

function rows_section(
	heading: string | undefined,
	rows: ReadonlyArray<BoardRow>,
	frame: RowFrame,
	stage?: YieldStage,
): Array<PlanSection> {
	return plan_section(
		heading,
		rows.map((row) => row_line(INDENT, row, frame, stage)),
	)
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
	notes: ReadonlyArray<BoardNote>,
	size: TerminalSize | undefined,
): RowFrame {
	const rows = run_board_layout.rows_of(layout)
	const frame = {
		header,
		time_width: time_width(header),
		slot_width: header.usages === undefined ? 0 : column_width(rows, header.now_ms),
		...WHOLE,
		columns: size?.columns,
		filed: run_board_notes.filed_numbers(notes),
	}

	return is_usage_fitting(rows, frame, size) ? frame : { ...frame, slot_width: 0 }
}

// The rows not yet started under one heading, in the order they are offered: a running batch starts
// each once a lane and its paths are free, never wave by wave (joshuafolkken/kit#4137).
function queued_section(layout: BoardLayout, frame: RowFrame): Array<PlanSection> {
	return plan_section(
		`${STATE_ICONS.waiting} ${WORDS.queued}`,
		layout.queued.flatMap((entry) => entry_lines(entry, frame)),
	)
}

// The rows above the findings: the run's own, the earlier run's lanes still holding a place, then the
// ones waiting on a person's decision — a child parked on one and an untouched plan row alike
// (joshuafolkken/kit#4099).
function active_sections(
	layout: BoardLayout,
	frame: RowFrame,
	done: ReadonlyArray<BoardRow>,
): Array<PlanSection> {
	const people = run_board_layout.people_of(layout)
	const lead = run_board_layout.lane_rows(layout, [...done, ...people])
	const decision = `${STATE_ICONS.human} ${WORDS.decision}`
	const cells = lane_cells_of(frame.header, lead)
	const shared = shared_overrun(lead, { ...frame, cells })
	const lanes = lanes_section(
		lead.map((row) => row_line(INDENT, row, { ...frame, cells, shared })),
		cells,
	)

	return [...lanes, ...rows_section(decision, people, frame)]
}

// The plan's rest under the findings, the 🔗 waiting rows giving way before them.
function plan_parts(
	header: BoardHeader,
	notes: ReadonlyArray<BoardNote>,
	size: TerminalSize | undefined,
): Pick<FrameParts, 'below' | 'plan'> {
	const { layout } = header

	if (layout === undefined) return { plan: [] }

	const frame = frame_of(header, layout, notes, size)
	const done = layout.active.filter((row) => run_board_layout.is_finished(row.state))
	const waiting = `${WAITS_ICON} ${WORDS.waiting}`

	return {
		plan: active_sections(layout, frame, done),
		below: [
			...keyed('queued', queued_section(layout, frame)),
			...keyed('waiting', rows_section(waiting, layout.unreached, frame, 'waiting')),
			...done_section(done, (row) => row_line(INDENT, row, frame)),
		],
	}
}

function render(view: BoardView): Array<string> {
	const { header, notes } = view
	const above = [...run_board_header.header_lines(header), ...resume_lines(view.resume)]
	const parts = {
		above,
		...plan_parts(header, notes, view.size),
		processes: run_board_render_processes.processes_part(header),
		notes: run_board_render_notes.notes_part(notes, header),
		thanks: thanks_part(view.thanks, view.link, view.size?.columns),
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
export type { BoardView }
