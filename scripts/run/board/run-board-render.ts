import {
	run_board_fit,
	type FrameParts,
	type PlanLine,
	type PlanSection,
	type TerminalSize,
	type YieldStage,
} from './run-board-fit'
import { run_board_fold, type FrameBounds } from './run-board-fold'
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
import type { Thanks } from './run-board-thanks-csv'
import type { ThroughputRow } from './run-board-throughput'

// The whole `run:board` screen as lines — pure, so what a person sees is tested apart from the
// terminal. The header says where the run is; under it the run's own rows, then the ones waiting on a
// person's decision, then the findings — what the run would otherwise have said in no chat anyone
// reads — and the plan's rest in its order. A section is a rule rather than a heading, and the legend
// at the foot names the symbols, so a row carries only what differs between rows. Every word is
// English whatever the session language: one set of words reads the same on every board.

const { STATE_ICONS, WAITS_ICON, WORDS } = run_board_labels
const { stops_width, time_width } = run_board_render_time
const { NOTE_LIMIT } = run_board_render_notes
const { lane_cells_of, lanes_section } = run_board_render_lanes
const { indent_of } = run_board_render_lead
const { TITLE_LIMIT, WHOLE, fitted_limit, title_of } = run_board_render_title
const { width_of } = run_board_fit
const { width_for } = run_board_render_condition
const { legend_lines, resume_lines, thanks_part } = run_board_render_foot
const { ROW_INDENT, done_section, kept_section, keyed, plan_section } = run_board_render_section
const { GAP, head_text, row_draw, row_fit, row_line, shared_overrun } = run_board_render_row
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
	const epic = title === '' ? number : `${number}${GAP}${title}`

	return [bare(`${ROW_INDENT}📁 ${epic}`), ...children]
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

	return [kept_section(`${STATE_ICONS.waiting} ${WORDS.queued}`, lines)]
}

// The column the lane rows' titles end in as drawn, cut as `fitted` cuts them, where every rule ends
// (joshuafolkken/kit#5520), kept within the pane; none without a lane row.
function rule_width(rows: ReadonlyArray<BoardRow>, frame: RowFrame): number | undefined {
	const ends = rows.map((row) => {
		const fit = row_fit(indent_of(row), row, frame)
		const draw = row_draw(indent_of(row), row, frame, fit)
		const title_limit = fitted_limit(row, frame.columns, draw, fit) ?? TITLE_LIMIT

		return width_of(`${indent_of(row)}${head_text(row, { ...frame, title_limit })}`)
	})

	if (ends.length === 0) return undefined

	return Math.min(Math.max(...ends), frame.columns ?? Infinity)
}

// The rows above the findings: the run's own, the earlier run's lanes still holding a place, then the
// ones waiting on a person's decision — a child parked on one and an untouched plan row alike
// (joshuafolkken/kit#4099).
function active_sections(
	layout: BoardLayout,
	frame: RowFrame,
): Pick<FrameParts, 'plan' | 'rule_width'> {
	const people = run_board_layout.people_of(layout)
	const lead = run_board_layout.lanes_drawn(layout)
	const decision = `${STATE_ICONS.human} ${WORDS.decision}`
	const cells = lane_cells_of(frame.header, lead)
	const lane_frame = { ...frame, cells, is_lane_row: true }
	const shared = shared_overrun(lead, lane_frame)
	const lanes = lanes_section(
		lead.map((row) => row_line(indent_of(row), row, { ...lane_frame, shared })),
		cells,
		frame.header,
		frame.columns,
	)

	const plan = [...lanes, ...rows_section(decision, people, frame)]

	return { plan, rule_width: rule_width(lead, { ...lane_frame, shared }) }
}

// The plan's rest under the findings, the 🔗 waiting rows giving way before them.
function plan_parts(
	header: BoardHeader,
	notes: ReadonlyArray<BoardNote>,
	size: TerminalSize | undefined,
): Pick<FrameParts, 'below' | 'plan' | 'rule_width'> {
	const { layout } = header

	if (layout === undefined) return { plan: [] }

	const frame = frame_of(header, notes, size)
	const conditioned = { ...frame, condition_width: width_for(layout.unreached) }
	const done = layout.active.filter((row) => run_board_layout.is_finished(row.state))
	const waiting = `${WAITS_ICON} ${WORDS.waiting}`

	return {
		...active_sections(layout, frame),
		below: [
			...keyed('queued', queued_section(layout, conditioned)),
			...keyed('waiting', rows_section(waiting, layout.unreached, conditioned, 'waiting')),
			...done_section(done, (row) => row_line(ROW_INDENT, row, conditioned)),
		],
	}
}

function render(view: BoardView): Array<string> {
	const { header, notes } = view
	const above = [...run_board_header.header_lines(header), ...resume_lines(view.resume)]
	const parts = {
		above,
		throughput: run_board_render_throughput.throughput_part(view.throughput),
		usage: run_board_render_quota.usage_part({ ...header, hold: header.quota_hold }),
		...plan_parts(header, notes, view.size),
		processes: run_board_render_processes.processes_part(header),
		notes: run_board_render_notes.notes_part(notes, { ...header, columns: view.size?.columns }),
		thanks: thanks_part(view.thanks, view.link, view.size?.columns),
		legend: legend_lines(header, notes),
		footer: view.footer ?? [],
	}

	return bounded(parts, view)
}

const run_board_render = {
	NOTE_LIMIT,
	TITLE_LIMIT,
	render,
	render_no_run: run_board_render_none.render_no_run,
}

export { run_board_render }
export type { BoardView }
