import { lane_spans, type IssueAt, type Span } from '#scripts/lane/lane-spans'
import type { LaneStateRecord } from '#scripts/lane/lane-state'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// How long a child of the run has spent on a lane: each launch until the event that took it off the
// lanes, summed, so the gap before a relaunch is not counted and a running row does not jump when it
// settles (joshuafolkken/kit#4463). The spans are built as `josh lane:stats` builds its gaps
// (`lane-spans.ts`).

const KIND = run_event_stream.EVENT_KIND
const LAUNCH_KINDS: ReadonlySet<string> = new Set([KIND.CHILD_LAUNCH, KIND.RESTART])
// What takes a child off the lanes. A cut or a resume keeps it there, so it ends no span.
const OFF_LANE_KINDS: ReadonlySet<string> = new Set([
	KIND.MERGE,
	KIND.PARK,
	KIND.WITHDRAW,
	KIND.OUTAGE,
	KIND.SPLIT,
	KIND.STOP,
])

function moments_of(events: ReadonlyArray<RunEvent>, kinds: ReadonlySet<string>): Array<IssueAt> {
	return events
		.filter((event) => kinds.has(event.kind))
		.map((event) => ({
			issue: Number(run_event_scope.issue_named(event)),
			at_ms: Date.parse(event.at),
		}))
}

// Each issue's spans on a lane, in launch order.
function spans_of(events: ReadonlyArray<RunEvent>): ReadonlyMap<number | undefined, Array<Span>> {
	const launches = moments_of(events, LAUNCH_KINDS)
	const ends = moments_of(events, OFF_LANE_KINDS)
	const issues = new Set(launches.map((launch) => launch.issue))

	return new Map(
		[...issues].map((issue) => {
			const starts = launches.filter((launch) => launch.issue === issue)

			return [issue, lane_spans.issue_spans({ starts, bounds: starts, ends })]
		}),
	)
}

function span_ms(span: Span, until_ms: number, end_ms: number): number {
	return Math.max(0, Math.min(span.end_ms ?? until_ms, end_ms) - span.from_ms)
}

// The time `spans` ran up to the row's end: a span nothing took off the lanes runs until the next
// launch, the last one until `end_ms` — now, a pause, or the issue's close.
function in_lane_ms(spans: ReadonlyArray<Span>, end_ms: number): number {
	return spans.reduce(
		(total, span, index) => total + span_ms(span, spans[index + 1]?.from_ms ?? end_ms, end_ms),
		0,
	)
}

// The time a child ran on a lane up to `ended_ms`: its spans summed, or from `started_ms` where its
// launch rolled off the stream and left none.
function elapsed_of(spans: ReadonlyArray<Span>, started_ms: number, ended_ms: number): number {
	return spans.length === 0 ? ended_ms - started_ms : in_lane_ms(spans, ended_ms)
}

interface EndingRead {
	// The whole stream, not a run's span: the launch may predate the run now drawing the board.
	events: ReadonlyArray<RunEvent>
	issue: number
	record: LaneStateRecord | undefined
	ended_ms: number
}

// When the lane record says the child last launched; a record with no launch has none.
function launched_ms(record: LaneStateRecord | undefined): number | undefined {
	const launched_at = record?.launched_at

	return launched_at === undefined ? undefined : Date.parse(launched_at)
}

// Where the board's count of an open lane begins: the start of the run that last launched it, whose span
// holds every launch the running row sums (`run-board-status.ts` → `with_spans`). A record the one-off
// migration wrote names no run, so it counts from its newest launch.
function counted_from(run: LaneStateRecord['run'], started_ms: number): number {
	return run === undefined ? started_ms : Date.parse(run.started_at)
}

function is_ended(spans: ReadonlyArray<Span>): boolean {
	return spans.at(-1)?.end_ms !== undefined
}

/**
 * The time an ending records for its child (joshuafolkken/kit#4481): computed once as it is written,
 * from the spans the run that last launched it holds — what the board sums for an open lane
 * (`run-board-lane-state.ts`), so the row keeps the time it drew while running. A child with no
 * recorded launch, or whose newest span already ended, is not on a lane this ending takes it off, so it
 * records none.
 */
function ending_elapsed(read: EndingRead): number | undefined {
	const started_ms = launched_ms(read.record)

	if (started_ms === undefined) return undefined

	const from_ms = counted_from(read.record?.run, started_ms)
	const spans = (spans_of(read.events).get(read.issue) ?? []).filter(
		(span) => span.from_ms >= from_ms,
	)

	return is_ended(spans) ? undefined : elapsed_of(spans, started_ms, read.ended_ms)
}

const run_board_lane_time = {
	LAUNCH_KINDS,
	OFF_LANE_KINDS,
	elapsed_of,
	ending_elapsed,
	in_lane_ms,
	spans_of,
}

export { run_board_lane_time }
export type { EndingRead }
