import { run_board_faint } from './run-board-faint'
import type { FrameParts, PlanLine, PlanSection, TerminalSize, YieldStage } from './run-board-fit'
import { run_board_fold, type FrameBounds } from './run-board-fold'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_labels } from './run-board-labels'
import {
	run_board_layout,
	type BoardLayout,
	type BoardRow,
	type QueuedEntry,
} from './run-board-layout'
import type { Link } from './run-board-link'
import { run_board_notes, type BoardNote } from './run-board-notes'
import { run_board_priority } from './run-board-priority'
import { run_board_render_condition } from './run-board-render-condition'
import { run_board_render_foot } from './run-board-render-foot'
import { run_board_render_lanes } from './run-board-render-lanes'
import { run_board_render_lead } from './run-board-render-lead'
import { run_board_render_none } from './run-board-render-none'
import { run_board_render_notes } from './run-board-render-notes'
import { run_board_render_processes } from './run-board-render-processes'
import { run_board_render_quota } from './run-board-render-quota'
import { run_board_render_row, type RowFrame } from './run-board-render-row'
import { run_board_render_section } from './run-board-render-section'
import { run_board_render_throughput } from './run-board-render-throughput'
import { run_board_render_time } from './run-board-render-time'
import { run_board_render_title } from './run-board-render-title'
import { run_board_row_key } from './run-board-row-key'
import { run_board_row_sections } from './run-board-row-sections'
import { run_board_rule_width } from './run-board-rule-width'
import type { Thanks } from './run-board-thanks-csv'
import type { ThroughputRow } from './run-board-throughput'

// The whole `run:board` screen as lines — pure, so what a person sees is tested apart from the
// terminal. The header says where the run is; under it the run's own rows, then the ones waiting on a
// person's decision, then the findings — what the run would otherwise have said in no chat anyone
// reads — and the plan's rest in its order. A section is a rule rather than a heading, and the legend
// at the foot names the symbols, so a row carries only what differs between rows. Every word is
// English whatever the session language: one set of words reads the same on every board.

const { STATE_ICONS, WAITS_ICON, WORDS } = run_board_labels
const { pair, titled } = run_board_label_pair
const { stops_width, time_width } = run_board_render_time
const { NOTE_LIMIT } = run_board_render_notes
const { lane_cells_of, lanes_section } = run_board_render_lanes
const { indent_of } = run_board_render_lead
const { TITLE_LIMIT, WHOLE, title_of } = run_board_render_title
const { width_for } = run_board_render_condition
const { legend_lines, resume_lines, thanks_part } = run_board_render_foot
const { ROW_INDENT, done_section, kept_section, keyed, plan_section } = run_board_render_section
const { GAP, row_line, shared_overrun } = run_board_render_row
const { tally_of } = run_board_priority
const BRANCH = `${ROW_INDENT}   ├ `
const LAST_BRANCH = `${ROW_INDENT}   └ `
const { bounded } = run_board_fold

interface BoardView extends FrameBounds {
	header: BoardHeader
	notes: ReadonlyArray<BoardNote>
	// The session a stopped run resumes from.
	resume?: string | undefined
	// The reviewers thanked above the legend, and the link a name with a page is wrapped in.
	thanks?: Thanks | undefined
	link?: Link | undefined
	// The 📈 throughput rows; none draws no section.
	throughput?: ReadonlyArray<ThroughputRow> | undefined
	// Whether the throughput rows end on the lamp panel (`run-board-lamps.ts`).
	has_lamps?: boolean | undefined
}

function bare(text: string): PlanLine {
	return { text, row: undefined }
}

// A running child turns the spinner in the first column of its branch where the header has one, so its
// tree says which child is moving.
function branch_of(prefix: string, row: BoardRow, header: BoardHeader): string {
	if (row.state !== 'running' || header.spinner === undefined) return prefix

	return `${header.spinner}${prefix.slice(1)}`
}

function epic_lines(
	entry: Extract<QueuedEntry, { kind: 'epic' }>,
	frame: RowFrame,
): Array<PlanLine> {
	const last = entry.rows.length - 1
	const children = entry.rows.map((row, index) =>
		row_line(branch_of(index === last ? LAST_BRANCH : BRANCH, row, frame.header), row, frame),
	)
	const title = title_of(entry.title)
	const number = frame.header.link(String(entry.epic))
	const epic = title === '' ? `📁 ${number}` : `📁 ${number}${GAP}${titled(title)}`
	const section = frame.header.is_keyed === true ? 'epic' : undefined

	return [bare(`${ROW_INDENT}${run_board_row_key.keyed(section, entry.epic, epic)}`), ...children]
}

function entry_lines(entry: QueuedEntry, frame: RowFrame): Array<PlanLine> {
	if (entry.kind === 'row') return [row_line(ROW_INDENT, entry.row, frame)]

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
		rows.map((row) => row_line(ROW_INDENT, row, frame, stage)),
	)
}

// The plan's rows drawn faint while the plan is a saved one (joshuafolkken/kit#8219).
function planned(header: BoardHeader, sections: Array<PlanSection>): Array<PlanSection> {
	if (header.plan_saved_ms === undefined) return sections

	return sections.map((section) => ({
		...section,
		lines: section.lines.map((line) => ({ ...line, text: run_board_faint.faint(line.text) })),
	}))
}

function frame_of(
	header: BoardHeader,
	notes: ReadonlyArray<BoardNote>,
	size: TerminalSize | undefined,
): RowFrame {
	return {
		header,
		time_width: time_width(header),
		stops_width: stops_width(header),
		...WHOLE,
		columns: size?.columns,
		filed: run_board_notes.filed_numbers(notes),
	}
}

// The rows not yet started under one heading, in the order they are offered: a running batch starts
// each once a lane and its paths are free, never wave by wave (joshuafolkken/kit#4137); kept at none.
function queued_section(layout: BoardLayout, frame: RowFrame): Array<PlanSection> {
	const lines = layout.queued.flatMap((entry) => entry_lines(entry, frame))

	return [kept_section(pair(STATE_ICONS.waiting, WORDS.queued), lines)]
}

// The rows above the findings: the run's own, the earlier run's lanes still holding a place, then the
// ones waiting on a person's decision — a child parked on one and an untouched plan row alike
// (joshuafolkken/kit#4099).
function active_sections(layout: BoardLayout, frame: RowFrame): Array<PlanSection> {
	const people = run_board_layout.people_of(layout)
	const lead = run_board_layout.lanes_drawn(layout)
	const decision = pair(STATE_ICONS.human, WORDS.decision)
	const cells = lane_cells_of(frame.header, lead)
	const lane_frame = { ...frame, cells, is_lane_row: true }
	const shared = shared_overrun(lead, lane_frame)
	const lanes = lanes_section(
		lead.map((row) => row_line(indent_of(row), row, { ...lane_frame, shared, section: 'lanes' })),
		cells,
		frame.header,
		frame.columns,
	)

	const decided = rows_section(decision, people, { ...frame, section: 'decision' })

	return [...lanes, ...planned(frame.header, decided)]
}

// The 🔗 rows waiting on an issue the run has not reached.
function waiting_section(layout: BoardLayout, frame: RowFrame): Array<PlanSection> {
	const waiting = pair(WAITS_ICON, WORDS.waiting)

	return rows_section(waiting, layout.unreached, { ...frame, section: 'waiting' }, 'waiting')
}

// The queued, waiting and done sections, the first two counting their priorities beside their rows
// (joshuafolkken/kit#8511), the plan read in flight and the saved plan's age at the queued rule's end
// (joshuafolkken/kit#8512).
function below_sections(layout: BoardLayout, frame: RowFrame): Array<PlanSection> {
	const { header } = frame
	const conditioned = { ...frame, condition_width: width_for(layout.unreached) }
	const done = run_board_row_sections.done_rows(layout)
	const queued = queued_section(layout, { ...conditioned, section: 'queued' })
	const waiting = waiting_section(layout, conditioned)
	const queued_tally = tally_of(run_board_layout.queued_rows(layout))

	return [
		...keyed('queued', planned(header, queued), queued_tally, run_board_header.queued_tail(header)),
		...keyed('waiting', planned(header, waiting), tally_of(layout.unreached)),
		...done_section(done, (row) => row_line(ROW_INDENT, row, { ...conditioned, section: 'done' })),
	]
}

// The plan's rest under the findings, the 🔗 waiting rows giving way before them.
function plan_parts(
	header: BoardHeader,
	notes: ReadonlyArray<BoardNote>,
	size: TerminalSize | undefined,
): Pick<FrameParts, 'below' | 'plan' | 'rule_width'> {
	const { layout } = header
	const frame = frame_of(header, notes, size)
	const rule_width = run_board_rule_width.rule_width(frame)

	if (layout === undefined) return { plan: [], rule_width }

	return { plan: active_sections(layout, frame), rule_width, below: below_sections(layout, frame) }
}

function render(view: BoardView): Array<string> {
	const { header, notes } = view
	const above = [...run_board_header.header_lines(header), ...resume_lines(view.resume)]
	const parts = {
		above,
		throughput: run_board_render_throughput.throughput_part(
			view.throughput,
			view.has_lamps,
			run_board_header.alert_part(header),
		),
		usage: run_board_render_quota.usage_part({
			...header,
			hold: header.quota_hold,
			has_lamps: view.has_lamps,
		}),
		...plan_parts(header, notes, view.size),
		processes: run_board_render_processes.processes_part(header),
		notes: run_board_render_notes.notes_part(notes, { ...header, columns: view.size?.columns }),
		thanks: thanks_part(view.thanks, view.link, view.size?.columns),
		legend: legend_lines(header, notes),
		footer: view.footer ?? [],
	}

	return run_board_label_pair.settled(bounded(parts, view), header)
}

const run_board_render = {
	NOTE_LIMIT,
	TITLE_LIMIT,
	render,
	render_no_run: run_board_render_none.render_no_run,
}

export { run_board_render }
export type { BoardView }
