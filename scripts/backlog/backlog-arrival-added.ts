import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// Whether the run's event stream holds an event of one kind since an instant: a `pnpm josh run:add`
// addition, or a `lane:limit` raise the drive asks about early (joshuafolkken/kit#6861).
// The arrival probe reads the backlog once a minute, and a `--only` run's pool is empty by definition, so
// an added issue would otherwise wait for the minute — or never wake a `--only` parent at all. The event
// stream is a local file, so this is read on every tick rather than on the probe's interval.

type EventReader = () => Promise<ReadonlyArray<RunEvent>>

async function read_stream(): Promise<ReadonlyArray<RunEvent>> {
	const target = await run_event_stream_emit.stream_target()

	return target === undefined ? [] : run_event_stream.read_events(target)
}

function has_kind_since(events: ReadonlyArray<RunEvent>, kind: string, since_ms: number): boolean {
	return events.some((event) => event.kind === kind && Date.parse(event.at) >= since_ms)
}

// A stream that cannot be read is no event: the probe's own backlog read is still the fallback.
async function is_kind_since(kind: string, since_ms: number, read: EventReader): Promise<boolean> {
	try {
		return has_kind_since(await read(), kind, since_ms)
	} catch {
		return false
	}
}

async function is_added_since(since_ms: number, read: EventReader = read_stream): Promise<boolean> {
	return await is_kind_since(run_event_stream.EVENT_KIND.ADD, since_ms, read)
}

// Whether `lane:limit` raised the limit since the instant — it writes the event on a raise only, so a
// lowered or reset limit reads false (joshuafolkken/kit#6861).
async function is_raised_since(
	since_ms: number,
	read: EventReader = read_stream,
): Promise<boolean> {
	return await is_kind_since(run_event_stream.EVENT_KIND.LANE_LIMIT, since_ms, read)
}

const backlog_arrival_added = { has_kind_since, is_added_since, is_raised_since }

export { backlog_arrival_added }
