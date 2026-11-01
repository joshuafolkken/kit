import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_progress } from '#scripts/run/progress/run-progress'
import { run_board_ending_states } from './run-board-ending-states'

// The `📈 throughput` cells of `run:board` (joshuafolkken/kit#5705), read from the run's event stream:
// when the run was alive, when each child closed, and per row the figures drawn beside its bar of cells.
// Local reads only, so the board redraws them with the rest; drawing them is the renderer's.

type RowLabel = '24h' | '7d'

interface Span {
	start_ms: number
	end_ms: number
}

// A cell with no `active_ms` was stopped throughout.
interface ThroughputCell extends Span {
	done: number
	active_ms: number
}

interface Peak {
	done: number
	per_hour: number
	start_ms: number
}

interface ThroughputRow {
	label: RowLabel
	// Oldest first; the last cell holds now and is still filling.
	cells: ReadonlyArray<ThroughputCell>
	window_ms: number
	active_ms: number
	done: number
	// Closes per active hour over the complete cells; none when they had no active time.
	per_hour: number | undefined
	peak: Peak | undefined
	// The closes in the current cell — the `24h` row's alone.
	now: number | undefined
}

interface RowShape {
	label: RowLabel
	cell_count: number
	cell_hours: number
	has_now: boolean
}

const KIND = run_event_stream.EVENT_KIND
const MINUTES_PER_HOUR = 60
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE
const HOURS_PER_DAY = 24
const HALF_DAY_HOURS = 12
const DAYS_PER_WEEK = 7
const HALVES_PER_DAY = 2
// A run beats every progress interval, so a quiet stretch longer than two of them is a stopped one.
const BEATS_PER_GAP = 2
const MAX_GAP_MS = BEATS_PER_GAP * run_progress.DEFAULT_INTERVAL_MS
// The run's own ending: a stop or a stranding that names no child.
const HALT_KINDS: ReadonlySet<string> = new Set([KIND.STOP, KIND.STRANDED])
const ROWS: ReadonlyArray<RowShape> = [
	{ label: '24h', cell_count: HOURS_PER_DAY, cell_hours: 1, has_now: true },
	{
		label: '7d',
		cell_count: DAYS_PER_WEEK * HALVES_PER_DAY,
		cell_hours: HALF_DAY_HOURS,
		has_now: false,
	},
]

function moment(event: RunEvent): number {
	return Date.parse(event.at)
}

function sum(values: ReadonlyArray<number>): number {
	return values.reduce((total, value) => total + value, 0)
}

function is_halt(event: RunEvent): boolean {
	return HALT_KINDS.has(event.kind) && run_event_scope.issue_named(event) === undefined
}

function next_ms(events: ReadonlyArray<RunEvent>, index: number, now_ms: number): number {
	const next = events[index + 1]

	return next === undefined ? now_ms : moment(next)
}

// The stretch from one event to the next (or to now) the run was alive through.
function span_after(event: RunEvent, end_ms: number): ReadonlyArray<Span> {
	const start_ms = moment(event)

	return is_halt(event) || end_ms - start_ms > MAX_GAP_MS ? [] : [{ start_ms, end_ms }]
}

function active_spans(events: ReadonlyArray<RunEvent>, now_ms: number): ReadonlyArray<Span> {
	return events.flatMap((event, index) => span_after(event, next_ms(events, index, now_ms)))
}

function close_entry(event: RunEvent): ReadonlyArray<[string, number]> {
	const issue = run_event_scope.issue_named(event)

	return issue === undefined ? [] : [[issue, moment(event)]]
}

// Each child's close, where the `✅ done` section draws it merged; a later close of the same child wins.
function close_times(events: ReadonlyArray<RunEvent>): ReadonlyArray<number> {
	const closes = events.filter((event) => run_board_ending_states.is_close(event))

	return [...new Map(closes.flatMap((event) => close_entry(event))).values()]
}

// Cells start on the local clock: the hour for `24h`, 00:00 and 12:00 for `7d`.
function current_start(shape: RowShape, now_ms: number): number {
	const date = new Date(now_ms)

	date.setHours(date.getHours() - (date.getHours() % shape.cell_hours), 0, 0, 0)

	return date.getTime()
}

// `cells` cells before the one starting at `start_ms`, stepped on the local clock so a daylight-saving
// change keeps every boundary on the hour, 00:00 or 12:00.
function start_before(shape: RowShape, start_ms: number, cells: number): number {
	const date = new Date(start_ms)

	date.setHours(date.getHours() - cells * shape.cell_hours)

	return date.getTime()
}

// Each cell ends where the next starts, so one a clock change falls in is an hour longer or shorter.
function cell_spans(shape: RowShape, now_ms: number): ReadonlyArray<Span> {
	const last_ms = current_start(shape, now_ms)
	const starts = Array.from({ length: shape.cell_count + 1 }, (_, index) =>
		start_before(shape, last_ms, shape.cell_count - 1 - index),
	)

	return starts.slice(0, -1).map((start_ms, index) => ({
		start_ms,
		end_ms: starts[index + 1] ?? start_ms,
	}))
}

function overlap_ms(span: Span, cell: Span): number {
	return Math.max(0, Math.min(span.end_ms, cell.end_ms) - Math.max(span.start_ms, cell.start_ms))
}

function cell_of(
	cell: Span,
	spans: ReadonlyArray<Span>,
	closes: ReadonlyArray<number>,
): ThroughputCell {
	const done = closes.filter((ms) => ms >= cell.start_ms && ms < cell.end_ms).length

	return { ...cell, done, active_ms: sum(spans.map((span) => overlap_ms(span, cell))) }
}

function per_hour_of(cells: ReadonlyArray<ThroughputCell>): number | undefined {
	const active_ms = sum(cells.map((cell) => cell.active_ms))

	if (active_ms === 0) return undefined

	return sum(cells.map((cell) => cell.done)) / (active_ms / MS_PER_HOUR)
}

// The newest of equal cells is the peak.
function peak_of(cells: ReadonlyArray<ThroughputCell>, cell_hours: number): Peak | undefined {
	const most = Math.max(0, ...cells.map((cell) => cell.done))
	const top = cells.findLast((cell) => cell.done === most)

	if (top === undefined || most === 0) return undefined

	return { done: top.done, per_hour: top.done / cell_hours, start_ms: top.start_ms }
}

interface StreamRead {
	spans: ReadonlyArray<Span>
	closes: ReadonlyArray<number>
	now_ms: number
}

// The current cell is drawn and counted in the window, but kept out of the average and the peak.
function row_of(shape: RowShape, read: StreamRead): ThroughputRow {
	const cells = cell_spans(shape, read.now_ms).map((cell) => cell_of(cell, read.spans, read.closes))
	const complete = cells.slice(0, -1)

	return {
		label: shape.label,
		cells,
		window_ms: sum(cells.map((cell) => cell.end_ms - cell.start_ms)),
		active_ms: sum(cells.map((cell) => cell.active_ms)),
		done: sum(cells.map((cell) => cell.done)),
		per_hour: per_hour_of(complete),
		peak: peak_of(complete, shape.cell_hours),
		now: shape.has_now ? cells.at(-1)?.done : undefined,
	}
}

function rows_of(events: ReadonlyArray<RunEvent>, now_ms: number): ReadonlyArray<ThroughputRow> {
	const read = { spans: active_spans(events, now_ms), closes: close_times(events), now_ms }

	return ROWS.map((shape) => row_of(shape, read))
}

const run_board_throughput = { rows_of }

export { run_board_throughput }
export type { Peak, ThroughputCell, ThroughputRow }
