import { lane_spans, type IssueAt, type Span } from '#scripts/lane/lane-spans'
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

const run_board_lane_time = { LAUNCH_KINDS, in_lane_ms, spans_of }

export { run_board_lane_time }
