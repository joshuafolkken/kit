import { timed_fetch } from '#scripts/lib/timed-fetch'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_offline_spans } from './lane-offline-spans'

// The host's network outages (joshuafolkken/kit#7867): a lane stalled on a dropped connection retries
// until it ends in an OUTAGE, and the stall read as work. The load sampler asks once a tick whether the
// network answers, and writes an `offline` or `online` event only when the answer changes; the pairs
// read back as intervals (`lane-offline-spans.ts`) every lane's time takes out beside the sleeps
// (`lane-host-gaps.ts`). The precision is a tick, and only outages since this recording began are known.

const { EVENT_KIND } = run_event_stream

// Any HTTP answer, an error status included, means the network is up. The request carries no
// credentials, headers or body, so nothing about the user or the project leaves the host.
const PROBE_URL = 'https://api.anthropic.com/'
const PROBE_INIT: RequestInit = { method: 'HEAD', credentials: 'omit', redirect: 'manual' }
const PROBE_TIMEOUT_MS = 5000

/** Whether the network answers the probe within its time limit. */
async function reachable(): Promise<boolean> {
	try {
		await timed_fetch(PROBE_URL, PROBE_INIT, PROBE_TIMEOUT_MS)

		return true
	} catch {
		return false
	}
}

async function target_of(events_path?: string): Promise<string | undefined> {
	return events_path ?? (await run_event_stream_emit.stream_target())
}

// The state the stream last recorded, so a drive started after an outage that outlived the previous
// drive writes the recovery that closes it.
async function recorded_online(events_path?: string): Promise<boolean> {
	const target = await target_of(events_path)

	if (target === undefined) return true

	return lane_offline_spans.ends_online(run_event_stream.read_events(target))
}

async function record(is_online: boolean, events_path?: string): Promise<void> {
	const target = await target_of(events_path)

	if (target === undefined) return

	run_event_stream.append_event(target, {
		at: new Date().toISOString(),
		kind: is_online ? EVENT_KIND.ONLINE : EVENT_KIND.OFFLINE,
		text: is_online ? 'network reachable again' : 'network unreachable',
	})
}

/** A per-tick check that probes and records only a change of state; it never throws. */
function watcher(events_path?: string): () => Promise<void> {
	// The last answer, held in place so overlapping ticks never write back a stale one.
	const seen: Array<boolean> = []

	async function check(): Promise<void> {
		try {
			const is_online = await reachable()
			const did_answer = seen.at(-1) ?? (await recorded_online(events_path))

			seen.splice(0, seen.length, is_online)
			if (is_online !== did_answer) await record(is_online, events_path)
		} catch {
			// Best-effort: an unrecorded outage counts as lane time, never as a failure of the run.
		}
	}

	return check
}

const lane_offline = { PROBE_URL, reachable, watcher }

export { lane_offline }
