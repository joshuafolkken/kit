import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import type { LaneSpan } from './lane-net-time'

// The host's sleep (joshuafolkken/kit#5032): a closed lid stops every lane, yet no park, outage or
// usage-limit event says so, and its minutes read as work. The load sampler's timer does not fire while
// the host sleeps, so a tick later than a few intervals is the sign: the wall clock past the tick that
// was due is recorded as one `sleep` event, and every lane's net time takes it out (`lane-net-time.ts`).
// A tick merely slowed by load runs well inside the threshold, so a busy host is not read as asleep.

const { EVENT_KIND } = run_event_stream

const GAP_INTERVALS = 3

/** The sleep between two ticks `interval_ms` apart, or `undefined` when the later one was on time. */
function gap_of(last_ms: number, now_ms: number, interval_ms: number): LaneSpan | undefined {
	if (now_ms - last_ms <= interval_ms * GAP_INTERVALS) return undefined

	return { from_ms: last_ms + interval_ms, to_ms: now_ms }
}

function event_of(span: LaneSpan): Omit<RunEvent, 'pos'> {
	const elapsed_ms = span.to_ms - span.from_ms
	const minutes = (elapsed_ms / MS_PER_MINUTE).toFixed(1)

	// Stamped at the wake, when it is appended: a stream reader takes its newest line for the newest time.
	return {
		at: new Date(span.to_ms).toISOString(),
		kind: EVENT_KIND.SLEEP,
		text: `host slept ${minutes} min`,
		elapsed_ms,
	}
}

/** Append `span` as a `sleep` event to `events_path`, or to this checkout's run stream when absent. */
async function record(span: LaneSpan, events_path?: string): Promise<void> {
	const target = events_path ?? (await run_event_stream_emit.stream_target())

	if (target === undefined) return

	run_event_stream.append_event(target, event_of(span))
}

// Every sleep on `events`, oldest first.
function spans(events: ReadonlyArray<RunEvent>): Array<LaneSpan> {
	return events
		.filter((event) => event.kind === EVENT_KIND.SLEEP)
		.map((event) => {
			const to_ms = Date.parse(event.at)

			return { from_ms: to_ms - (event.elapsed_ms ?? 0), to_ms }
		})
}

const lane_sleep = { gap_of, record, spans }

export { lane_sleep }
