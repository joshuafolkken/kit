import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_ledger } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import type { MeasureContext } from './lane-sampler'

// The ledger and the event stream the lane measurements read, and the one lane's net minutes read from
// them — `josh lane:net` and the causing-lane line `josh issue:file --found-during` prints
// (joshuafolkken/kit#5225) share it.

type ReadContext = Pick<MeasureContext, 'ledger_path' | 'events_path'>

async function read_ledger(
	context: ReadContext,
): Promise<ReturnType<typeof lane_ledger.read_entries>> {
	const path = context.ledger_path ?? (await lane_ledger.target())

	return path === undefined ? [] : lane_ledger.read_entries(path)
}

// The run's event stream, read for the parks that end a stop's wait.
async function read_events(context: ReadContext): Promise<ReadonlyArray<RunEvent>> {
	if (context.events_path !== undefined) return run_event_stream.read_events(context.events_path)

	return await run_event_stream_emit.all_events()
}

// The lane's net minutes, whole; `undefined` when the ledger holds no dispatch and merge of it.
async function net_minutes_of(
	issue: number,
	context: ReadContext = {},
): Promise<number | undefined> {
	const events = await read_events(context)

	return lane_net_time.net_minutes(await read_ledger(context), events, issue)
}

const lane_net_read = {
	net_minutes_of,
	read_events,
	read_ledger,
}

export { lane_net_read }
