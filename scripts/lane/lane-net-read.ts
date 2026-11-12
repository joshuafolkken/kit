import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_implement_rate_read } from './lane-implement-rate-read'
import type { lane_ledger } from './lane-ledger'
import { lane_ledger_archive } from './lane-ledger-archive'
import { lane_net_time } from './lane-net-time'
import type { MeasureContext } from './lane-sampler'

// The ledger and the event stream the lane measurements read, and the one lane's net minutes read from
// them — `josh lane:net` and the causing-lane line `josh issue:file --found-during` prints
// (joshuafolkken/kit#5225) share it.

type ReadContext = Pick<MeasureContext, 'ledger_path' | 'events_path'>

const { implement_rate, measurements, read_ledger } = lane_implement_rate_read

// The run's event stream, read for the parks that end a stop's wait.
async function read_events(context: ReadContext): Promise<ReadonlyArray<RunEvent>> {
	if (context.events_path !== undefined) return run_event_stream.read_events(context.events_path)

	return await run_event_stream_emit.all_events()
}

// The ledger with its archive (joshuafolkken/kit#7038), beside the event stream — the records one lane's
// `lane:why` reads, whenever it was dispatched.
async function read_records(context: ReadContext): Promise<{
	entries: ReturnType<typeof lane_ledger.read_entries>
	events: ReadonlyArray<RunEvent>
}> {
	return {
		entries: await lane_ledger_archive.read_history(context),
		events: await read_events(context),
	}
}

// The lane's net minutes, whole; `undefined` when neither the ledger nor its archive holds a dispatch
// and merge of it.
async function net_minutes_of(
	issue: number,
	context: ReadContext = {},
): Promise<number | undefined> {
	const events = await read_events(context)

	return lane_net_time.net_minutes(await lane_ledger_archive.read_history(context), events, issue)
}

const lane_net_read = {
	implement_rate,
	measurements,
	net_minutes_of,
	read_events,
	read_ledger,
	read_records,
}

export { lane_net_read }
