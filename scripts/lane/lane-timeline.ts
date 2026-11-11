import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { lane_breakdown, type Breakdown, type Segment } from './lane-breakdown'
import { lane_ledger, type LedgerEntry, type ShipLapEntry } from './lane-ledger'
import { lane_net_time, type LaneSpan } from './lane-net-time'
import { lane_stop_stats } from './lane-stop-stats'
import { lane_yield } from './lane-yield'

// `josh lane:breakdown <issue> --timeline` — one lane in time order, one line an event
// (joshuafolkken/kit#7186). Each stage `lane_breakdown.of` cut, at its net minutes, so the stage lines
// add up to the net time; each wait it takes out, named by what opened it; the driver's followup; and
// the points the stages hide — a main merge-in, a split or `unplanned` notice, a split, a ship launch
// and a review round.

const { EVENT_KIND } = run_event_stream
const { KIND } = lane_ledger

const ROW = { STAGE: 'stage', EXCLUDED: 'excluded', DRIVER: 'driver', EVENT: 'event' } as const

type RowKind = (typeof ROW)[keyof typeof ROW]

// One line: a stage, a wait or the driver's followup with its milliseconds, or a point event, with
// none unless it ran a while (a main merge-in).
interface TimelineRow {
	at_ms: number
	ms?: number
	name: string
	kind: RowKind
}

interface Timeline {
	from_ms: number
	rows: ReadonlyArray<TimelineRow>
}

interface Records {
	entries: ReadonlyArray<LedgerEntry>
	events: ReadonlyArray<RunEvent>
}

interface Mark {
	at_ms: number
	name: string
}

const MERGE_STEP = 'merge'
const NO_KIND = 'wait'
const SLEEP_KIND = 'sleep'
const CLOCK_LENGTH = 16
const COLUMN_WIDTH = 9

// The events that open a wait `lane_net_time.waits` takes out, by the name its line carries.
const WAIT_EVENTS: ReadonlyArray<readonly [string, string]> = [
	[EVENT_KIND.PARK, 'park'],
	[EVENT_KIND.OUTAGE, 'outage'],
	[EVENT_KIND.USAGE_LIMIT, 'usage limit'],
	[EVENT_KIND.SPLIT, 'split'],
]

// The events printed as points.
const POINT_EVENTS: ReadonlyArray<readonly [string, string]> = [
	[EVENT_KIND.SHIP_LAUNCH, 'ship launch'],
	[EVENT_KIND.REVIEW_ROUND, 'review round'],
	[EVENT_KIND.SPLIT, 'split'],
]

function is_inside(at_ms: number, span: LaneSpan): boolean {
	return at_ms >= span.from_ms && at_ms < span.to_ms
}

function marks_of(
	events: ReadonlyArray<RunEvent>,
	issue: number,
	kinds: ReadonlyArray<readonly [string, string]>,
): Array<Mark> {
	return kinds.flatMap(([kind, name]) =>
		lane_stop_stats
			.events_of(events, kind)
			.filter((hit) => hit.issue === issue)
			.map((hit) => ({ at_ms: hit.at_ms, name })),
	)
}

function yield_marks(events: ReadonlyArray<RunEvent>, issue: number): Array<Mark> {
	const notes = events.filter((event) => lane_yield.is_yield_note(event))

	return marks_of(notes, issue, [[EVENT_KIND.NOTE, 'yield']])
}

function overlaps(left: LaneSpan, right: LaneSpan): boolean {
	return left.from_ms < right.to_ms && right.from_ms < left.to_ms
}

// What opened `wait` — the holds, yields and splits whose line falls in it, and a host sleep across
// it — or `wait` where nothing named it.
function wait_name(
	wait: LaneSpan,
	marks: ReadonlyArray<Mark>,
	slept: ReadonlyArray<LaneSpan>,
): string {
	const named = marks.filter((mark) => is_inside(mark.at_ms, wait)).map((mark) => mark.name)
	const kinds = [...named, ...(slept.some((sleep) => overlaps(sleep, wait)) ? [SLEEP_KIND] : [])]

	return kinds.length === 0 ? NO_KIND : [...new Set(kinds)].join(' + ')
}

function wait_rows(
	events: ReadonlyArray<RunEvent>,
	issue: number,
	breakdown: Breakdown,
	span: LaneSpan,
): Array<TimelineRow> {
	const marks = [...marks_of(events, issue, WAIT_EVENTS), ...yield_marks(events, issue)]
	const slept = lane_net_time.slept(events, span)

	return breakdown.waits.map((wait) => ({
		at_ms: wait.from_ms,
		ms: wait.to_ms - wait.from_ms,
		name: wait_name(wait, marks, slept),
		kind: ROW.EXCLUDED,
	}))
}

function is_followup(segment: Segment): boolean {
	return segment.stage === lane_breakdown.FOLLOWUP_STAGE
}

// Each stage's net time — `lane_breakdown.of`'s stages, each span apart — and the followup, all driver
// time, left to `driver_rows`.
function stage_rows(breakdown: Breakdown): Array<TimelineRow> {
	return (breakdown.segments ?? [])
		.filter((segment) => !is_followup(segment))
		.map((segment) => ({
			at_ms: segment.from_ms,
			ms: segment.net_ms,
			name: segment.stage,
			kind: ROW.STAGE,
		}))
}

// Each followup less the waits inside it: the driver's CI, CodeRabbit and merge wait.
function driver_rows(breakdown: Breakdown): Array<TimelineRow> {
	const followups = (breakdown.segments ?? []).filter((segment) => is_followup(segment))

	return followups.map((segment) => ({
		at_ms: segment.from_ms,
		ms: segment.to_ms - segment.from_ms - lane_breakdown.covered_ms(segment, breakdown.waits),
		name: `${lane_breakdown.DRIVER_FOLLOWUP_STAGE} (CI wait)`,
		kind: ROW.DRIVER,
	}))
}

function is_merge_lap(entry: LedgerEntry, issue: number): entry is ShipLapEntry {
	return entry.kind === KIND.SHIP_LAP && entry.issue === issue && entry.step === MERGE_STEP
}

// Each merge of main a ship ran, from its start: a lap's `at` is its end.
function merge_rows(entries: ReadonlyArray<LedgerEntry>, issue: number): Array<TimelineRow> {
	return entries
		.filter((entry) => is_merge_lap(entry, issue))
		.map((lap) => ({
			at_ms: Date.parse(lap.at) - lap.elapsed_ms,
			ms: lap.elapsed_ms,
			name: `main merge-in (ship ${lap.stage})`,
			kind: ROW.EVENT,
		}))
}

// A split or `unplanned` notice's line, or `undefined` for any other entry.
function notice_name(entry: LedgerEntry): string | undefined {
	if (entry.kind === KIND.SPLIT_NOTICE) return `split notice (${entry.reason ?? 'diff'})`

	return entry.kind === KIND.UNPLANNED_NOTICE
		? `unplanned notice (${entry.files.join(', ')})`
		: undefined
}

function notice_row(entry: LedgerEntry): Array<TimelineRow> {
	const name = notice_name(entry)

	return name === undefined ? [] : [{ at_ms: Date.parse(entry.at), name, kind: ROW.EVENT }]
}

// The split and `unplanned` notices the lane was given.
function notice_rows(entries: ReadonlyArray<LedgerEntry>, issue: number): Array<TimelineRow> {
	return entries
		.filter((entry) => 'issue' in entry && entry.issue === issue)
		.flatMap((entry) => notice_row(entry))
}

function point_rows(records: Records, issue: number): Array<TimelineRow> {
	const events = marks_of(records.events, issue, POINT_EVENTS).map((mark) => ({
		...mark,
		kind: ROW.EVENT,
	}))

	return [...events, ...merge_rows(records.entries, issue), ...notice_rows(records.entries, issue)]
}

/**
 * `issue`'s lane in time order, or `undefined` when the ledger holds no dispatch and merge of it —
 * `breakdown` is its `lane_breakdown.of`, whose spans the rows are cut from.
 */
function of(records: Records, issue: number, breakdown: Breakdown): Timeline | undefined {
	const span = lane_net_time.span_of(records.entries, issue)

	if (span === undefined) return undefined

	const points = point_rows(records, issue).filter((row) => is_inside(row.at_ms, span))
	const rows = [
		...stage_rows(breakdown),
		...driver_rows(breakdown),
		...wait_rows(records.events, issue, breakdown, span),
		...points,
	]

	return { from_ms: span.from_ms, rows: rows.toSorted((left, right) => left.at_ms - right.at_ms) }
}

// The net milliseconds the stage lines add up to.
function net_ms(timeline: Timeline): number {
	return timeline.rows
		.filter((row) => row.kind === ROW.STAGE)
		.reduce((sum, row) => sum + (row.ms ?? 0), 0)
}

function clock(at_ms: number): string {
	return `${new Date(at_ms).toISOString().slice(0, CLOCK_LENGTH).replace('T', ' ')}Z`
}

function row_text(row: TimelineRow, from_ms: number): string {
	const elapsed = `+${((row.at_ms - from_ms) / MS_PER_MINUTE).toFixed(1)}`
	const took = row.ms === undefined ? '-' : lane_breakdown.minutes_text(row.ms)
	const tag = row.kind === ROW.STAGE ? '' : `[${row.kind}] `

	return `${clock(row.at_ms)}  ${elapsed.padStart(COLUMN_WIDTH)}  ${took.padStart(COLUMN_WIDTH)}  ${tag}${row.name}`
}

// The timeline's lines under a header naming the columns, and the stage lines' sum.
function text(lane: string, timeline: Timeline): string {
	const head = `${lane} timeline — start (UTC), minutes since dispatch, duration, event`
	const lines = timeline.rows.map((row) => row_text(row, timeline.from_ms))
	const total = `net ${lane_breakdown.minutes_text(net_ms(timeline))} — the stage lines' sum; [excluded], [driver] and [event] lines stand apart`

	return [head, ...lines, total].join('\n')
}

const lane_timeline = { ROW, net_ms, of, text }

export { lane_timeline }
export type { Timeline, TimelineRow }
