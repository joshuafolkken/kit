import { lane_capacity } from '#scripts/lane/lane-capacity'
import { run_board_earlier } from './run-board-earlier'
import { run_board_fit } from './run-board-fit'
import { run_board_fresh } from './run-board-fresh'
import type { BoardHeader } from './run-board-header'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_icon } from './run-board-render-icon'
import { run_board_render_tail } from './run-board-render-tail'
import { run_board_render_time } from './run-board-render-time'
import { run_board_render_waits } from './run-board-render-waits'

// What a lane row draws before its usage cells (joshuafolkken/kit#4292): the progress column — the
// spinner while it runs, 🚧 while its lane is held, blanks where it stopped — the phase's icon, how
// long it has stood at the phase and how long it has run, each time eight columns right-aligned. A held
// lane draws why and how long it is held in the run's time's place, so every column after it stays put.

const { BUDGET_ICON, held_of, held_time } = run_board_render_waits
const { phase_time } = run_board_render_tail
const { state_icon } = run_board_render_icon
const { net_of } = run_board_render_time
const { WAIT_ICONS } = run_board_labels
// The widest span a time column draws: `1°14′58″`.
const TIME_WIDTH = 8
const LANE_INDENT = '  '
// The progress column: an emoji two columns wide, or the spinner and a blank.
const PROGRESS_WIDTH = 2
const PROGRESS_BLANK = ' '.repeat(PROGRESS_WIDTH)
const ICON_WIDTH = 2
const ICON_BLANK = ' '.repeat(ICON_WIDTH)
// A stopped single run's progress column: done as a finished row is, until its next step is typed.
const STOPPED_SINGLE_ICON = run_board_labels.STATE_ICONS.merged
const SPACE = 1
// The column the run's time starts at, which the rule's ⏰ stands over.
const ELAPSED_START =
	LANE_INDENT.length + PROGRESS_WIDTH + SPACE + ICON_WIDTH + SPACE + TIME_WIDTH + SPACE
// The column a lane row's usage cells start at, after the lead and one blank; the processes rows' too.
const USAGE_START = ELAPSED_START + TIME_WIDTH + SPACE
const LANES_LABEL = run_board_label_pair.pair(run_board_labels.LANES_ICON, 'lanes')
// A single run's rule (joshuafolkken/kit#7523): it runs in the root checkout, not in a lane, so its
// row stands under the command it runs rather than under the lanes.
const SINGLE_RUN_ICON = '🏠'
// An open head's ▾ and its blank, and the blank, rule and blank before the first column, so a lane
// row's icon stands in `ROW_INDENT`'s column under a counted label (joshuafolkken/kit#8257); a chat's
// two leading rules draw that column one further right.
const RULE_ROOM = 5

function root_label(run_name: string): string {
	return `${SINGLE_RUN_ICON} ${run_name}`
}

function lane_label(header: BoardHeader): string {
	if (header.run_name !== undefined) return root_label(header.run_name)
	const seats = lane_capacity.seat_text(header.lane_capacity)
	if (seats !== undefined) return `${run_board_labels.LANES_ICON} ${seats}`
	if (header.occupied_count === undefined) return LANES_LABEL

	return `${LANES_LABEL} ${String(header.occupied_count)}/${String(header.lane_limit ?? '—')}`
}

function column_offset(header: BoardHeader): number {
	return Math.max(0, run_board_fit.width_of(lane_label(header)) + RULE_ROOM - ELAPSED_START)
}

// A running row's part that changed at `at_ms`, emphasized while fresh (`run-board-fresh.ts`) — its
// start and its phase; a settled row's are long past.
function running_fresh(
	row: BoardRow,
	text: string,
	at_ms: number | undefined,
	header: BoardHeader,
): string {
	return run_board_earlier.is_live(row) ? run_board_fresh.since(text, at_ms, header) : text
}

// A single run a stop ended before its next step (joshuafolkken/kit#7710): its 🏠 row beside a carried
// run, or its own board's row, which only a stop ends. A lane's stopped row is drawn as before.
function is_single_ended(header: BoardHeader): boolean {
	return header.run_name !== undefined && header.ended_ms !== undefined
}

function is_stopped_single(row: BoardRow, header: BoardHeader): boolean {
	if (row.state !== 'stopped') return false

	return header.layout?.root?.row === row || is_single_ended(header)
}

function progress_of(row: BoardRow, header: BoardHeader): string {
	if (is_stopped_single(row, header)) return STOPPED_SINGLE_ICON
	if (held_of(row, header) !== undefined) return BUDGET_ICON
	if (row.state !== 'running' || header.spinner === undefined) return PROGRESS_BLANK

	return `${header.spinner} `
}

// How long the row has run, or why and how long its lane is held while it is. The time is net of the
// host's stops without the bracket that names them, so the cells after it stay under their columns.
function whole_of(row: BoardRow, header: BoardHeader): string {
	const held = held_of(row, header)

	if (held !== undefined) return held_time(held, TIME_WIDTH)

	const time = net_of(row, header.now_ms) ?? ''
	const fresh = running_fresh(row, time, row.status?.started_ms, header)

	return run_board_fresh.padded(time, TIME_WIDTH, fresh)
}

// A lane row's indent: 🧍 on a `run:solo` row (joshuafolkken/kit#4625), as wide as the blanks it
// replaces, so every column after it stays put.
function indent_of(row: BoardRow): string {
	return row.is_solo === true ? WAIT_ICONS.solo : LANE_INDENT
}

// The icon a row leads with, which the legend names too: none on a stopped single run's, whose ✅ stands
// in the progress column.
function icon_of(row: BoardRow, header: BoardHeader): string {
	return is_stopped_single(row, header) ? ICON_BLANK : state_icon(row)
}

// A lane row's lead after its indent, ending where its usage cells start less one blank. A wide label's
// offset falls after the icon, so the icon keeps `ROW_INDENT`'s column (joshuafolkken/kit#8257).
function lead_of(row: BoardRow, header: BoardHeader): string {
	const icon = running_fresh(row, icon_of(row, header), row.status?.phase_ms, header)
	const phase = phase_time(row, header, TIME_WIDTH)
	const shifted = `${icon}${' '.repeat(column_offset(header))}`

	return [progress_of(row, header), shifted, phase, whole_of(row, header)].join(' ')
}

const run_board_render_lead = {
	ELAPSED_START,
	LANES_LABEL,
	LANE_INDENT,
	TIME_WIDTH,
	USAGE_START,
	column_offset,
	icon_of,
	indent_of,
	lead_of,
	lane_label,
	root_label,
	running_fresh,
}

export { run_board_render_lead }
