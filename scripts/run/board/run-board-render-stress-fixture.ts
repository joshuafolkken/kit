import { stripVTControlCharacters } from 'node:util'
import type { BudgetWait } from '#scripts/gate/core-wait'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow, QueuedEntry, RowReason } from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemStatus } from './run-board-status'

// A board whose every value runs long (joshuafolkken/kit#4518): a hold past ten minutes (#4292), a
// cross-repo `owner/repo#N` wait (#4288), and full-width titles and reasons (#4060), drawn on a pane of
// any size so a suite reads which column each row's number starts in and what a short pane drops.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, board_usage, header, note } = run_board_render_fixture
const { WAIT_ICONS } = run_board_labels
const SECOND = 1000
const HELD_SECONDS = 5
const LONG_HOLD_MINUTES = 10
const RUN_MINUTES = 15
const PHASE_MINUTES = 11
const STOPPED_MINUTES = 7
const RUNNING = 4001
const HELD = 4002
const STOPPED = 4003
const DONE = 4004
const CROSS = 4005
const LANES = 4006
const REASONED = 4007
const CROSS_REPO = 'joshuafolkken/josh#1234'
const WIDE_REASON = '全角の理由が長く続いて画面の幅を超える'
const NOTE_TEXT = 'a note on the run'

function title_of(number: number): string {
	return `Issue ${String(number)} 全角のタイトルが長く続く行の描画`
}

function row(
	number: number,
	state: BoardRow['state'],
	status?: ItemStatus,
	reason?: RowReason,
): BoardRow {
	return { number, title: title_of(number), kind: undefined, state, status, waits: [], reason }
}

function running(number: number): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - RUN_MINUTES * MINUTE,
		track: ['implement' as const],
		phase_ms: NOW - PHASE_MINUTES * MINUTE,
	}

	return row(number, 'running', status)
}

function active(): Array<BoardRow> {
	const stopped = {
		state: 'stopped' as const,
		started_ms: NOW - STOPPED_MINUTES * MINUTE,
		ended_ms: NOW,
	}
	const merged = { state: 'merged' as const, started_ms: STARTED, ended_ms: NOW - MINUTE }

	return [
		running(RUNNING),
		running(HELD),
		row(STOPPED, 'stopped', stopped),
		row(DONE, 'merged', merged),
	]
}

function queued(): Array<QueuedEntry> {
	const waiting = [
		row(CROSS, 'waiting', undefined, { icon: WAIT_ICONS.blocker, issues: [CROSS_REPO, '4001'] }),
		row(LANES, 'waiting', undefined, { icon: WAIT_ICONS.lane, value: '4/4' }),
		row(REASONED, 'waiting', undefined, { tail: WIDE_REASON }),
	]

	return waiting.map((entry) => ({ kind: 'row', row: entry }))
}

// A memory hold on the held lane's check, past ten minutes so its seconds overrun the time column.
const hold: BudgetWait = {
	command: 'lint:related',
	lane: String(HELD),
	elsewhere: undefined,
	waited_ms: LONG_HOLD_MINUTES * MINUTE + HELD_SECONDS * SECOND,
	reason: 'pressure',
}

function board(): BoardHeader {
	const layout = { ...EMPTY_LAYOUT, active: active(), queued: queued() }

	return header({ layout, budget_waits: [hold], usages: board_usage(new Map()), spinner: '⠋' })
}

function notes(): Array<BoardNote> {
	return [note(NOW - MINUTE, NOTE_TEXT)]
}

// The board's lines on a pane of `columns` × `rows`, or with no pane, color escapes stripped.
function lines_on(columns?: number, rows = Number.MAX_SAFE_INTEGER): Array<string> {
	const size = columns === undefined ? undefined : { columns, rows }

	return run_board_render
		.render({ header: board(), notes: notes(), size })
		.map((line) => stripVTControlCharacters(line))
}

const run_board_render_stress_fixture = {
	CROSS,
	DONE,
	HELD,
	LANES,
	NOTE_TEXT,
	REASONED,
	RUNNING,
	STOPPED,
	WIDE_REASON,
	lines_on,
}

export { run_board_render_stress_fixture }
