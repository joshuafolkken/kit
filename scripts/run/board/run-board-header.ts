import { styleText } from 'node:util'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { backlog_idle, type IdleWindow } from '#scripts/backlog/backlog-idle'
import { run_board_labels, type Words } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import { run_board_machine, type MachineGauges } from './run-board-machine'
import type { RunActivity } from './run-board-status'

// The top of `run:board` (joshuafolkken/kit#3430): whether the run is moving, how long it has run, how
// long it has left, how fresh its last event is, and how far through the plan it is — and, while it
// waits on an empty backlog, until when it waits and what ends the wait. Every time comes from a record
// (the carry's start, the stream's events, the `idle` window); nothing here guesses one. Two lines of
// symbols rather than sentences (joshuafolkken/kit#3444): the `⏱` that moves every second is the proof
// the board is live, so no `updated` line is drawn. Under the title, the machine the run is on
// (joshuafolkken/kit#3450), so a slow run reads apart from a stuck one.

const { HEADER_ICONS, STATE_ICONS, bar_of, clock_of, elapsed_of, left_of, span_of } =
	run_board_labels
const COUNT_GAP = '  '
const PROGRESS_GAP = COUNT_GAP
// The parts of the title line sit one space further apart than the counts, so the groups read apart.
const GAP = `${COUNT_GAP} `
// A running run whose newest event is older than this is drawn as stale, so a hang stands out; past
// twice that it is drawn as alarming.
const STALE_MINUTES = 15
const STALE_MS = STALE_MINUTES * backlog_budget.MS_PER_MINUTE
const ALARM_FACTOR = 2
const ALARM_MS = STALE_MS * ALARM_FACTOR
const INDENT = '  '
const RUN_NAME = 'backlogrun'
const CLOCK_MINUTES_END = 5

interface BoardHeader {
	now_ms: number
	words: Words
	started_ms: number
	// Set once the run has ended (joshuafolkken/kit#3439): the title then says when, and how long it took.
	ended_ms: number | undefined
	activity: RunActivity
	layout: BoardLayout | undefined
	// The total the board first saw, so arrivals since then read as `(+N)`.
	baseline_total: number | undefined
	plan_fetched_ms: number | undefined
	plan_failed_ms: number | undefined
	// The machine's gauges, `undefined` before the first sample.
	machine: MachineGauges | undefined
	// The spinner's frame a running run and a running row turn, `undefined` where the output is not a
	// terminal and they draw their still icons (joshuafolkken/kit#3452).
	spinner: string | undefined
	// An issue reference as the board draws it — `3450` or `owner/repo#12` — made a link where the
	// terminal opens one.
	link: (reference: string) => string
}

interface BoardCounts {
	total: number
	settled: number
	merged: number
	parked: number
	running: number
	remaining: number
}

type RunMark = 'running' | 'idle' | 'human' | 'stopped'

type TextColor = Parameters<typeof styleText>[0]

// The run's state as a colored glyph before its name.
const RUN_MARKS: Readonly<Record<RunMark, { glyph: string; color: TextColor }>> = {
	running: { glyph: '▶', color: 'green' },
	idle: { glyph: '⏸', color: 'yellow' },
	human: { glyph: '✋', color: 'magenta' },
	stopped: { glyph: '■', color: 'gray' },
}

function count_state(rows: ReadonlyArray<BoardRow>, state: BoardRow['state']): number {
	return rows.filter((row) => row.state === state).length
}

function counts_of(layout: BoardLayout): BoardCounts {
	const total = run_board_layout.rows_of(layout).length
	const merged = count_state(layout.active, 'merged')
	const parked = count_state(layout.active, 'parked')
	const settled = merged + parked + count_state(layout.active, 'done')
	const running = count_state(layout.active, 'running')

	return { total, settled, merged, parked, running, remaining: total - settled - running }
}

// Nothing running: the run is waiting on a person when all the plan has left is what
// `needs-decision` holds, and otherwise idle.
function quiet_mark(layout: BoardLayout | undefined): RunMark {
	return layout?.waves.length === 0 && layout.people.length > 0 ? 'human' : 'idle'
}

// The run's state, each state overriding the ones below it.
function mark_of(header: BoardHeader, running: number): RunMark {
	if (header.activity.is_stopped) return 'stopped'
	if (running > 0) return 'running'

	return header.activity.idle === undefined ? quiet_mark(header.layout) : 'idle'
}

// A running run turns the spinner in place of ▶, both one column wide; every other mark stands still.
function run_part(mark: RunMark, spinner: string | undefined): string {
	const { glyph, color } = RUN_MARKS[mark]
	const shown = mark === 'running' ? (spinner ?? glyph) : glyph

	return styleText(color, `${shown} ${RUN_NAME}`)
}

function aged(part: string, age_ms: number): string {
	if (age_ms > ALARM_MS) return styleText('red', part)

	return age_ms > STALE_MS ? styleText('yellow', part) : part
}

// How long ago the stream last moved; only a running run can be stale, so only it is colored. An ended
// run has no heartbeat to keep (joshuafolkken/kit#3450): one counting on would read as a hang.
function heartbeat_part(header: BoardHeader, mark: RunMark): string | undefined {
	const last = header.activity.last_event_ms

	if (last === undefined || header.ended_ms !== undefined) return undefined

	const age = header.now_ms - last
	const part = `💓 ${elapsed_of(age)}`

	return mark === 'running' ? aged(part, age) : part
}

// A plan fetch is said only when it failed — the board otherwise keeps quiet about a routine read.
function plan_warning(header: BoardHeader): string | undefined {
	const failed = header.plan_failed_ms

	if (failed === undefined) return undefined

	return styleText(
		'yellow',
		`⚠ ${header.words.plan} ${clock_of(failed).slice(0, CLOCK_MINUTES_END)}`,
	)
}

// A running run's age and time left before the cut-off, or an ended run's frozen duration and the
// minute it ended — an ended run has no cut-off left (joshuafolkken/kit#3439, joshuafolkken/kit#3450).
function time_parts(header: BoardHeader): Array<string> {
	const { now_ms, started_ms, ended_ms } = header

	if (ended_ms !== undefined) {
		const ended = clock_of(ended_ms).slice(0, CLOCK_MINUTES_END)

		return [`⏱ ${elapsed_of(ended_ms - started_ms)}`, `${HEADER_ICONS.ended} ${ended}`]
	}

	const cutoff = started_ms + backlog_budget.WHOLE_RUN_BUDGET_MS

	return [`⏱ ${elapsed_of(now_ms - started_ms)}`, `⌛ ${left_of(cutoff - now_ms)}`]
}

function title_line(header: BoardHeader, running: number): string {
	const mark = mark_of(header, running)
	const parts = [
		run_part(mark, header.spinner),
		...time_parts(header),
		heartbeat_part(header, mark),
		plan_warning(header),
	]

	return parts.filter((part) => part !== undefined).join(GAP)
}

function progress_line(counts: BoardCounts, header: BoardHeader): string {
	const added = counts.total - (header.baseline_total ?? counts.total)
	const plus = added > 0 ? ` (+${String(added)})` : ''
	const tally = `${String(counts.settled)}/${String(counts.total)}${plus}`
	const breakdown = [
		`${STATE_ICONS.merged} ${String(counts.merged)}`,
		`${STATE_ICONS.parked} ${String(counts.parked)}`,
		`${STATE_ICONS.running} ${String(counts.running)}`,
		`${STATE_ICONS.waiting} ${String(counts.remaining)}`,
	].join(COUNT_GAP)

	const bar = `${HEADER_ICONS.progress} ${bar_of(counts.settled, counts.total)}`

	return `${bar}${PROGRESS_GAP}${tally}${GAP}${breakdown}`
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
	const progress = counts === undefined ? undefined : progress_line(counts, header)

	return [
		title_line(header, running),
		...[run_board_machine.line_of(header.machine), progress].filter((line) => line !== undefined),
		...idle_block(header, running),
	]
}

const run_board_header = { counts_of, header_lines }

export { run_board_header }
export type { BoardCounts, BoardHeader }
