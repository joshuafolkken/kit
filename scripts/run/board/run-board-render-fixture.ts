import { stripVTControlCharacters } from 'node:util'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader, BoardUsage } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout } from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import type { ProcessGroups } from './run-board-process-groups'
import { run_board_render } from './run-board-render'
import { run_board_render_title } from './run-board-render-title'
import { run_board_rule_width } from './run-board-rule-width'
import type { LaneUsages, UsageFigure } from './run-board-usage'

// What the `run_board_render` suites share: a header at a fixed moment, and the
// board's lines with the color escapes stripped, so an assertion reads the screen as a person does.

const { WORDS } = run_board_labels
const MINUTE = MS_PER_MINUTE
const STARTED = Date.parse('2026-10-08T09:00:00.000Z')
// A run past an hour exercises hour formatting in both the rows and the header.
const RUN_MINUTES = 130
const NOW = STARTED + RUN_MINUTES * MINUTE
const EMPTY_LAYOUT: BoardLayout = { active: [], queued: [], people: [], unreached: [] }
const { WHOLE } = run_board_render_title
const GB = 1_073_741_824
const CORES = 10
const MEMORY_GB = 16
const NO_FIGURE: UsageFigure = { cpu_cores: 0, memory_bytes: 0, compressed_bytes: 0 }

function header(extra: Partial<BoardHeader> = {}): BoardHeader {
	return {
		now_ms: NOW,
		started_ms: STARTED,
		ended_ms: undefined,
		activity: { last_event_ms: NOW - MINUTE, is_stopped: false },
		layout: EMPTY_LAYOUT,
		baseline_total: undefined,
		plan_fetched_ms: NOW,
		plan_failed_ms: undefined,
		is_plan_loading: false,
		machine: undefined,
		is_investigation_on: false,
		spinner: undefined,
		form: 'screen',
		repo: undefined,
		link: (reference) => reference,
		pull_link: String,
		repo_link: String,
		...extra,
	}
}

function lines_of(board: BoardHeader, notes: ReadonlyArray<BoardNote> = []): Array<string> {
	return run_board_render
		.render({ header: board, notes })
		.map((line) => stripVTControlCharacters(line))
}

// A machine of `CORES` cores and `MEMORY_GB` gigabytes, nothing running outside the lanes given.
function board_usage(lanes: LaneUsages, processes: Partial<ProcessGroups> = {}): BoardUsage {
	const empty = { total: NO_FIGURE, top: [], entries: [] }
	const backlogrun = {
		total: NO_FIGURE,
		supervisor: NO_FIGURE,
		parent: NO_FIGURE,
		lanes: { count: 0, figure: NO_FIGURE },
	}

	return {
		lanes,
		processes: { backlogrun, apps: empty, leftover: empty, ...processes },
		scale: { cores: CORES, total_bytes: MEMORY_GB * GB },
	}
}

// A rule of a whole frame drawn from the default header: every rule runs on to where a lane row's full
// title ends, lane row or none (joshuafolkken/kit#8247).
function rule(label: string): string {
	const frame = { header: header(), time_width: 0, stops_width: 0, columns: undefined }
	const width = run_board_rule_width.rule_width({ ...frame, ...WHOLE, filed: new Set() })
	const head = `── ${label} `

	return head.padEnd(width - run_board_fit.width_of(head) + head.length, '─')
}

function note(at_ms: number, text: string): BoardNote {
	return { kind: 'note', at_ms, issue: '3415', text }
}

// The `🎯 —` a parked row ends on, and an unmeasured running row draws before its activity
// (joshuafolkken/kit#7920, #7994, #8166).
const UNKNOWN_FINISH = '🎯 —'

// A parked row's line without the `🎯 —` it ends on, its gap trimmed.
function unfinished(line: string): string {
	return line.endsWith(UNKNOWN_FINISH) ? line.slice(0, -UNKNOWN_FINISH.length).trimEnd() : line
}

const run_board_render_fixture = {
	EMPTY_LAYOUT,
	GB,
	MINUTE,
	NOW,
	STARTED,
	UNKNOWN_FINISH,
	WORDS,
	board_usage,
	header,
	lines_of,
	note,
	rule,
	unfinished,
}

export { run_board_render_fixture }
