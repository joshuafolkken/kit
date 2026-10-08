import { styleText } from 'node:util'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { backlog_idle, type IdleWindow } from '#scripts/backlog/backlog-idle'
import { run_board_labels, type Words } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { RunActivity } from './run-board-status'

// The top of `run:board` (joshuafolkken/kit#3430): whether the run is moving, since when, until when,
// how far through the plan it is, and — while it waits on an empty backlog — until when it waits and
// what ends the wait. Every time comes from a record (the carry's start, the stream's events, the
// `idle` window); nothing here guesses one.

const { clock_of, span_of } = run_board_labels
const SEPARATOR = ' · '
const BAR_WIDTH = 20
const BAR_DONE = '━'
const BAR_LEFT = '░'
// A running run whose newest event is older than this is drawn as stale, so a hang stands out.
const STALE_MINUTES = 15
const STALE_MS = STALE_MINUTES * backlog_budget.MS_PER_MINUTE
const INDENT = '  '

interface BoardHeader {
	now_ms: number
	words: Words
	started_ms: number
	activity: RunActivity
	layout: BoardLayout | undefined
	// The total the board first saw, so arrivals since then read as `(+N)`.
	baseline_total: number | undefined
	plan_fetched_ms: number | undefined
	plan_failed_ms: number | undefined
}

interface BoardCounts {
	total: number
	settled: number
	merged: number
	parked: number
	running: number
	remaining: number
}

function count_state(rows: ReadonlyArray<BoardRow>, state: BoardRow['state']): number {
	return rows.filter((row) => row.state === state).length
}

function plan_size(layout: BoardLayout): number {
	const wave_rows = layout.waves
		.flat()
		.flatMap((entry) => (entry.kind === 'row' ? [entry.row] : entry.rows))

	return wave_rows.length + layout.people.length + layout.unreached.length
}

function counts_of(layout: BoardLayout): BoardCounts {
	const total = layout.active.length + plan_size(layout)
	const merged = count_state(layout.active, 'merged')
	const parked = count_state(layout.active, 'parked')
	const settled = merged + parked + count_state(layout.active, 'done')
	const running = count_state(layout.active, 'running')

	return { total, settled, merged, parked, running, remaining: total - settled - running }
}

// Nothing running and no idle window: the run is waiting on a person when all the plan has left is
// what `needs-decision` holds.
function quiet_label(header: BoardHeader): string {
	const { layout, words } = header
	const is_human = layout?.waves.length === 0 && layout.people.length > 0

	return is_human ? words.human : words.idle
}

// The run's state, each state overriding the ones below it.
function state_label(header: BoardHeader, running: number): string {
	const { activity, words } = header

	if (activity.is_stopped) return words.stopped
	if (running > 0) return words.running

	return activity.idle === undefined ? quiet_label(header) : words.idle_drained
}

function last_event_part(header: BoardHeader, is_running: boolean): string | undefined {
	const last = header.activity.last_event_ms

	if (last === undefined) return undefined

	const age = header.now_ms - last
	const part = `${header.words.last_event} ${clock_of(last)} (${span_of(age)})`

	return is_running && age > STALE_MS ? styleText('yellow', part) : part
}

function title_line(header: BoardHeader, running: number): string {
	const { now_ms, started_ms, words } = header
	const state = state_label(header, running)
	const cutoff = started_ms + backlog_budget.WHOLE_RUN_BUDGET_MS
	const parts = [
		`backlogrun ${state}`,
		`${words.started} ${clock_of(started_ms)} (${span_of(now_ms - started_ms)})`,
		`${words.cutoff} ${clock_of(cutoff)}`,
		last_event_part(header, state === words.running),
	]

	return parts.filter((part) => part !== undefined).join(SEPARATOR)
}

function plan_part(header: BoardHeader): string {
	const { words, plan_fetched_ms, plan_failed_ms } = header
	const fetched =
		plan_fetched_ms === undefined
			? words.plan_none
			: `${words.plan} ${clock_of(plan_fetched_ms)} ${words.plan_fetched}`

	if (plan_failed_ms === undefined) return fetched

	const failure = `⚠ ${words.plan_failed} ${clock_of(plan_failed_ms)}`

	return `${fetched}${SEPARATOR}${styleText('yellow', failure)}`
}

function update_line(header: BoardHeader): string {
	return `${header.words.updated} ${clock_of(header.now_ms)}${SEPARATOR}${plan_part(header)}`
}

function bar_of(counts: BoardCounts): string {
	const done = counts.total === 0 ? 0 : Math.round((counts.settled / counts.total) * BAR_WIDTH)

	return BAR_DONE.repeat(done) + BAR_LEFT.repeat(BAR_WIDTH - done)
}

function progress_line(counts: BoardCounts, header: BoardHeader): string {
	const { words } = header
	const added = counts.total - (header.baseline_total ?? counts.total)
	const plus = added > 0 ? ` (+${String(added)})` : ''
	const icons = run_board_labels.STATE_ICONS
	const breakdown = [
		`${icons.merged} ${String(counts.merged)} ${words.merged}`,
		`${icons.parked} ${String(counts.parked)} ${words.parked}`,
		`${icons.running} ${String(counts.running)} ${words.in_progress}`,
		`${icons.waiting} ${String(counts.remaining)} ${words.remaining}`,
	].join(SEPARATOR)

	return `${words.progress} ${String(counts.settled)}/${String(counts.total)}${plus} ${bar_of(counts)}  ${breakdown}`
}

function idle_lines(idle: IdleWindow, header: BoardHeader): Array<string> {
	const { words, now_ms } = header
	const ending = idle.bound === 'idle' ? words.idle_end_idle : words.idle_end_run
	const left = `${words.idle_left} ${span_of(idle.until_ms - now_ms)}`
	const next_check = clock_of(backlog_idle.next_check_ms(idle))

	return [
		`${INDENT}${words.idle_until} ${clock_of(idle.until_ms)} (${left}) → ${ending}`,
		`${INDENT}${words.next_check} ${next_check}`,
	]
}

// The wait is drawn only while it is what the run is doing: nothing running and the run not ended.
function idle_block(header: BoardHeader, running: number): Array<string> {
	const { idle, is_stopped } = header.activity

	if (is_stopped || idle === undefined || running > 0) return []

	return idle_lines(idle, header)
}

function header_lines(header: BoardHeader): Array<string> {
	const counts = header.layout === undefined ? undefined : counts_of(header.layout)
	const running = counts?.running ?? 0

	return [
		title_line(header, running),
		...idle_block(header, running),
		update_line(header),
		...(counts === undefined ? [] : [progress_line(counts, header)]),
	]
}

const run_board_header = { counts_of, header_lines }

export { run_board_header }
export type { BoardCounts, BoardHeader }
