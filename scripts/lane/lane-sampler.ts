import { lane_ledger } from './lane-ledger'
import { lane_load } from './lane-load'

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

/** Sample now and then every minute; the returned function stops it. */
function start(context: MeasureContext = {}): () => void {
	void take_quietly(context)
	const timer = setInterval(() => {
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
