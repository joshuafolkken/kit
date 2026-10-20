import { run_board_earlier } from './run-board-earlier'
import { run_board_fresh } from './run-board-fresh'
import type { BoardHeader } from './run-board-header'
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
const { time_of } = run_board_render_time
// The widest span a time column draws: `1°14′58″`.
const TIME_WIDTH = 8
const LANE_INDENT = '  '
// The progress column: an emoji two columns wide, or the spinner and a blank.
const PROGRESS_WIDTH = 2
const PROGRESS_BLANK = ' '.repeat(PROGRESS_WIDTH)
const ICON_WIDTH = 2
const SPACE = 1
// The column the run's time starts at, which the rule's ⏰ stands over.
const ELAPSED_START =
	LANE_INDENT.length + PROGRESS_WIDTH + SPACE + ICON_WIDTH + SPACE + TIME_WIDTH + SPACE
// The column a lane row's usage cells start at, after the lead and one blank; the processes rows' too.
const USAGE_START = ELAPSED_START + TIME_WIDTH + SPACE

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

function progress_of(row: BoardRow, header: BoardHeader): string {
	if (held_of(row, header) !== undefined) return BUDGET_ICON
	if (row.state !== 'running' || header.spinner === undefined) return PROGRESS_BLANK

	return `${header.spinner} `
}

// How long the row has run, or why and how long its lane is held while it is.
function whole_of(row: BoardRow, header: BoardHeader): string {
	const held = held_of(row, header)

	if (held !== undefined) return held_time(held, TIME_WIDTH)

	const time = time_of(row, header.now_ms) ?? ''
	const fresh = running_fresh(row, time, row.status?.started_ms, header)

	return run_board_fresh.padded(time, TIME_WIDTH, fresh)
}

// A lane row's lead after its indent, ending where its usage cells start less one blank.
function lead_of(row: BoardRow, header: BoardHeader): string {
	const icon = running_fresh(row, state_icon(row), row.status?.phase_ms, header)
	const phase = phase_time(row, header, TIME_WIDTH)

	return [progress_of(row, header), icon, phase, whole_of(row, header)].join(' ')
}

const run_board_render_lead = {
	ELAPSED_START,
	LANE_INDENT,
	TIME_WIDTH,
	USAGE_START,
	lead_of,
	running_fresh,
}

export { run_board_render_lead }
