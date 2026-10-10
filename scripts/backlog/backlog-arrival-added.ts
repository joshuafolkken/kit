import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// Whether `pnpm josh run:add` handed the run an issue since the watcher started.
// The arrival probe reads the backlog once a minute, and a `--only` run's pool is empty by definition, so
// an added issue would otherwise wait for the minute — or never wake a `--only` parent at all. The event
// stream is a local file, so this is read on every tick rather than on the probe's interval.

type EventReader = () => Promise<ReadonlyArray<RunEvent>>

async function read_stream(): Promise<ReadonlyArray<RunEvent>> {
	const target = await run_event_stream_emit.stream_target()

	return target === undefined ? [] : run_event_stream.read_events(target)
}

function has_added_since(events: ReadonlyArray<RunEvent>, since_ms: number): boolean {
	return events.some(
		(event) => event.kind === run_event_stream.EVENT_KIND.ADD && Date.parse(event.at) >= since_ms,
	)
}

// A stream that cannot be read is no addition: the probe's own backlog read is still the fallback.
async function is_added_since(since_ms: number, read: EventReader = read_stream): Promise<boolean> {
	try {
		return has_added_since(await read(), since_ms)
	} catch {
		return false
	}
}

const backlog_arrival_added = { has_added_since, is_added_since }

export { backlog_arrival_added }
