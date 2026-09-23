import { telegram_notify } from '#scripts/git/telegram-notify'
import { run_event_stream, type RunEvent } from '#scripts/run/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/run-event-stream-emit'
import { backlog_ready, type ReadyPorts } from './backlog-ready'
import { backlog_stalled, type StallReading, type StallVerdict } from './backlog-stalled'

// The I/O half of the stall detector (joshuafolkken/kit#2359): it gathers the three counts the pure
// judge in `backlog-stalled.ts` weighs, then — on a stall — leaves the marker and sends the one
// notification. `stop-guard.ts` wires it into the Stop hook, so it runs at each loop boundary; the CLI
// exposes the same call for a person to run by hand.
//
// **Cheap first.** The costly read is `backlog:next`, a subprocess that hits the network. The two local
// reads gate it: the dispatch age comes free from the stream this already reads, and the free-lane count
// is one `git worktree list`. Neither the lane count nor the backlog read is made unless the cheaper
// condition ahead of it already holds, so an ordinary stop — a run not idle, or with no free lane —
// costs a single file read and nothing more.

const NO_FREE = 0
const NO_READY = 0
const NO_AGE = 0

// The recovery line names the command that resolves the stall — the same one `run:step` points a stalled
// run at — so the person the notification reaches has the fix in hand.
const STALL_RECOVERY = 'Dispatch the ready work with `pnpm josh backlog:next`.'

// The seams a test replaces: the stream target and its events, the clock, the two counts, and the two
// side effects. The defaults are the real readers; a test hands fakes so the gather and report logic run
// without a git tree, a network or a wall clock.
interface DetectPorts {
	resolve_target: () => Promise<string | undefined>
	read_events: (target: string) => ReadonlyArray<RunEvent>
	now_ms: () => number
	free_lane_count: () => Promise<number>
	ready_count: () => Promise<number>
	emit_stall: (text: string) => Promise<boolean>
	notify_stalled: (body: string) => Promise<boolean>
}

// The free-lane and runnable-issue reads are `backlog-ready.ts`'s — the watcher's ready line reads the
// same two, so they live once there (joshuafolkken/kit#2452) — and a caller that reads them again after
// this check hands its own ports in, so the two share one reading (joshuafolkken/kit#2472).
function ready_count_of(ready: ReadyPorts): () => Promise<number> {
	return async function (): Promise<number> {
		const issues = await ready.ready_issues()

		return issues.length
	}
}

// One stall per episode, and the episode ends at a dispatch rather than at whatever event lands next
// (joshuafolkken/kit#2464) — every parallel lane appends to this stream, so a newest-event dedup re-fired.
async function real_emit_stall(text: string): Promise<boolean> {
	const { STALL, CHILD_LAUNCH } = run_event_stream.EVENT_KIND

	return await run_event_stream_emit.emit_once_since(STALL, text, CHILD_LAUNCH)
}

async function real_notify_stalled(body: string): Promise<boolean> {
	return await telegram_notify.stalled({ body, recovery: STALL_RECOVERY })
}

function ports_over(ready: ReadyPorts): DetectPorts {
	return {
		resolve_target: run_event_stream_emit.stream_target,
		read_events: run_event_stream.read_events,
		now_ms: () => Date.now(),
		free_lane_count: ready.free_lane_count,
		ready_count: ready_count_of(ready),
		emit_stall: real_emit_stall,
		notify_stalled: real_notify_stalled,
	}
}

const DEFAULT_PORTS: DetectPorts = ports_over(backlog_ready.DEFAULT_PORTS)

function ok_reading(dispatch_age_ms: number): StallReading {
	return { ready_count: NO_READY, free_lanes: NO_FREE, dispatch_age_ms }
}

// The idle-and-past-threshold branch, where the costly reads finally happen: count the free lanes, and
// only if one is free read the backlog. A full pool short-circuits before the network call — a stall
// needs a lane to go into.
async function probe_reading(ports: DetectPorts, dispatch_age_ms: number): Promise<StallReading> {
	const free_lanes = await ports.free_lane_count()

	if (free_lanes <= NO_FREE) return { ready_count: NO_READY, free_lanes, dispatch_age_ms }

	return { ready_count: await ports.ready_count(), free_lanes, dispatch_age_ms }
}

// The reading that decides the verdict, assembled cheap-condition-first. `undefined` is the unreadable
// answer: no stream to key on, so no run to be stalled. Every early return yields a reading the judge
// maps to `ok`; only when the run is idle past the threshold does `probe_reading` make the costly reads.
async function gather(ports: DetectPorts, threshold_ms: number): Promise<StallReading | undefined> {
	const target = await ports.resolve_target()

	if (target === undefined) return undefined

	const age = backlog_stalled.dispatch_age_ms(ports.read_events(target), ports.now_ms())

	if (age === undefined) return ok_reading(NO_AGE)
	if (age <= threshold_ms) return ok_reading(age)

	return await probe_reading(ports, age)
}

// The marker and the notification, both once per stall episode. `emit_stall` refuses a second until a
// dispatch has intervened, and its `false` is what holds the notification back too — so a stall
// polled every stop reaches the person once, not once a turn.
async function report(ports: DetectPorts, reading: StallReading): Promise<void> {
	const text = backlog_stalled.describe(reading)

	if (await ports.emit_stall(text)) await ports.notify_stalled(text)
}

// Read the three conditions, print nothing, and on a stall leave the marker and notify. The verdict is
// returned for the CLI to print; the side effects are the report's.
async function detect_and_report(
	ports: DetectPorts = DEFAULT_PORTS,
	threshold_ms: number = backlog_stalled.STALL_THRESHOLD_MS,
): Promise<StallVerdict> {
	const reading = await gather(ports, threshold_ms)
	const verdict = backlog_stalled.assess(reading, threshold_ms)

	if (reading !== undefined && verdict === backlog_stalled.STALLED) await report(ports, reading)

	return verdict
}

// Best-effort for the Stop hook: the detector is a report, so a failure to gather or notify is dropped
// rather than raised into the stop decision it rides alongside.
async function run_stall_check(ready: ReadyPorts = backlog_ready.DEFAULT_PORTS): Promise<void> {
	try {
		await detect_and_report(ports_over(ready))
	} catch {
		// Reporting is best-effort: a stall we could not read or send is dropped, never a blocked stop.
	}
}

const backlog_stalled_detect = { DEFAULT_PORTS, detect_and_report, gather, report, run_stall_check }

export { backlog_stalled_detect }
export type { DetectPorts }
