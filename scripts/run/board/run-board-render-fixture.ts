import { stripVTControlCharacters } from 'node:util'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout } from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import { run_board_render } from './run-board-render'

// What the `run_board_render` suites share: a header at a fixed moment, and the
// board's lines with the color escapes stripped, so an assertion reads the screen as a person does.

const { WORDS } = run_board_labels
const MINUTE = backlog_budget.MS_PER_MINUTE
const STARTED = Date.parse('2026-10-08T09:00:00.000Z')
// The run has gone 130 minutes, so an elapsed time past an hour reads as `MM:SS` (`125:30`).
const RUN_MINUTES = 130
const NOW = STARTED + RUN_MINUTES * MINUTE
const EMPTY_LAYOUT: BoardLayout = { active: [], waves: [], people: [], unreached: [] }
const RULE_WIDTH = 50

function header(extra: Partial<BoardHeader> = {}): BoardHeader {
	return {
		now_ms: NOW,
		started_ms: STARTED,
		ended_ms: undefined,
		activity: { last_event_ms: NOW - MINUTE, idle: undefined, is_stopped: false },
		layout: EMPTY_LAYOUT,
		baseline_total: undefined,
		plan_fetched_ms: NOW,
		plan_failed_ms: undefined,
		is_plan_loading: false,
		machine: undefined,
		spinner: undefined,
		form: 'screen',
		link: (reference) => reference,
		...extra,
	}
}

function lines_of(board: BoardHeader, notes: ReadonlyArray<BoardNote> = []): Array<string> {
	return run_board_render
		.render({ header: board, notes })
		.map((line) => stripVTControlCharacters(line))
}

function rule(label: string): string {
	return `── ${label} `.padEnd(RULE_WIDTH, '─')
}

function note(at_ms: number, text: string): BoardNote {
	return { kind: 'note', at_ms, issue: '3415', text, is_decision: false }
}

const run_board_render_fixture = {
	EMPTY_LAYOUT,
	MINUTE,
	NOW,
	STARTED,
	WORDS,
	header,
	lines_of,
	note,
	rule,
}

export { run_board_render_fixture }
