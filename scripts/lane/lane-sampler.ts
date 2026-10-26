import { lane_ledger } from './lane-ledger'
import { lane_load } from './lane-load'
import type { LaneSpan } from './lane-net-time'
import { lane_sleep } from './lane-sleep'

// The machine-load sampler: one `load` entry appended to the lane ledger, once or on a timer.
//
// **`start` is how a `backlogrun` samples itself.** `backlog:drive` starts it for as long as its loop
// runs, so a period needs nobody to remember a second terminal — the sampler `josh lane:sample` offers
// was started by hand, and a run nobody started it beside recorded no load at all. The timer lives in
// the drive's own process and is unreferenced: it ends with the drive, never holds it open, and leaves
// no process or pid file behind to stop.

const SAMPLE_INTERVAL_MS = 60_000

// Where the ledger is and what "now" is, overridable so a test reads a fixed ledger at a fixed instant.
interface MeasureContext {
	ledger_path?: string
	// The run's event stream `lane:stats` reads parks from and a sleep is recorded on; absent, the
	// repository's own.
	events_path?: string
	// The lane transcript directories `lane:stats` reads tool calls from; absent, this repository's lanes'.
	transcript_directories?: ReadonlyArray<string>
	now_ms?: number
}

async function take(context: MeasureContext = {}): Promise<void> {
	const at = new Date(context.now_ms ?? Date.now()).toISOString()

	await lane_ledger.record(await lane_load.sample(at), context.ledger_path)
}

// A timer tick has no caller to raise into, and a sample that could not be read must never end the run
// it measures.
async function take_quietly(context: MeasureContext): Promise<void> {
	try {
		await take(context)
	} catch {
		// Best-effort: an unread sample is a gap in the measurement, not a failure of the run.
	}
}

// A sleep that could not be recorded is a gap in the measurement, the same as an unread sample.
async function record_quietly(span: LaneSpan, context: MeasureContext): Promise<void> {
	try {
		await lane_sleep.record(span, context.events_path)
	} catch {
		// Best-effort: an unrecorded sleep counts as lane time, never as a failure of the run.
	}
}

/** Sample now and then every minute, recording a tick the host slept through; the returned function stops it. */
function start(context: MeasureContext = {}): () => void {
	let last_ms = Date.now()

	void take_quietly(context)
	const timer = setInterval(() => {
		const now_ms = Date.now()
		const slept = lane_sleep.gap_of(last_ms, now_ms, SAMPLE_INTERVAL_MS)

		last_ms = now_ms
		if (slept !== undefined) void record_quietly(slept, context)
		void take_quietly(context)
	}, SAMPLE_INTERVAL_MS).unref()

	return () => {
		clearInterval(timer)
	}
}

const lane_sampler = {
	SAMPLE_INTERVAL_MS,
	start,
	take,
}

export type { MeasureContext }
export { lane_sampler }
