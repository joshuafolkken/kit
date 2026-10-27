import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { backlog_ready, type ReadyPorts } from './backlog-ready'
import { backlog_stalled, type StallReading, type StallVerdict } from './backlog-stalled'

// The I/O half of the stall detector: it gathers the three counts the pure
// judge in `backlog-stalled.ts` weighs, then — on a stall — leaves the marker `run:step` reads as
// `backlog:next`. It sends no Telegram (joshuafolkken/kit#4015): a stall resolves itself at the next
// dispatch, so the person it reached had nothing to do; the idle notification `backlog:drive` sends
// when nothing is left to dispatch is the one that wants a hand. `stop-guard.ts` wires it into the Stop hook, so it runs at each loop boundary; the CLI
// exposes the same call for a person to run by hand.
//
// **Cheap first.** The costly read is `backlog:next`, a subprocess that hits the network. The two local
// reads gate it: the dispatch age comes free from the stream this already reads, and the free-lane count
// is one `git worktree list`. Neither the lane count nor the backlog read is made unless the cheaper
// condition ahead of it already holds, so an ordinary stop — a run not idle, or with no free lane —
// costs a single file read and nothing more.
//
// **A stall is aged from when work and a lane first met** (joshuafolkken/kit#4349). Each probe records,
// on the lane ledger, whether offerable work and a free lane coexist — only when that changes — and the
// wait runs from the observation that opened the current episode. The dispatch age stays the cheap
// gate: the wait can never exceed it.

const NO_FREE = 0
const NO_READY = 0
const NO_AGE = 0

// The seams a test replaces: the stream target and its events, the clock, the two counts, the ledger,
// and the marker. The defaults are the real readers; a test hands fakes so the gather and report logic
// run without a git tree, a network or a wall clock.
interface DetectPorts {
	resolve_target: () => Promise<string | undefined>
	read_events: (target: string) => ReadonlyArray<RunEvent>
	now_ms: () => number
	free_lane_count: () => Promise<number>
	ready_count: () => Promise<number>
	read_ledger: () => Promise<ReadonlyArray<LedgerEntry>>
	mark_offerable: (is_offerable: boolean) => Promise<void>
	emit_stall: (text: string) => Promise<boolean>
}

interface Counts {
	ready_count: number
	free_lanes: number
}

// The dispatch reference the episode is bounded by, and the probe's own time.
interface Clock {
	reference_ms: number
	now_ms: number
}

// The free-lane and runnable-issue reads are `backlog-ready.ts`'s — the watcher's ready line reads the
// same two, so they live once there — and a caller that reads them again after
// this check hands its own ports in, so the two share one reading.
function ready_count_of(ready: ReadyPorts): () => Promise<number> {
	return async function (): Promise<number> {
		const issues = await ready.ready_issues()

		return issues.length
	}
}

// One stall per episode, and the episode ends at a dispatch rather than at whatever event lands next
// — every parallel lane appends to this stream, so a newest-event dedup re-fired.
async function real_emit_stall(text: string): Promise<boolean> {
	const { STALL, CHILD_LAUNCH } = run_event_stream.EVENT_KIND

	return await run_event_stream_emit.emit_once_since(STALL, text, CHILD_LAUNCH)
}

// A test run has no ledger (`lane_ledger.target`), so it reads as empty there.
async function read_real_ledger(): Promise<ReadonlyArray<LedgerEntry>> {
	const path = await lane_ledger.target()

	return path === undefined ? [] : lane_ledger.read_entries(path)
}

async function real_mark_offerable(is_offerable: boolean): Promise<void> {
	await lane_ledger_write.record_offerable(is_offerable)
}

function ports_over(ready: ReadyPorts): DetectPorts {
	return {
		resolve_target: run_event_stream_emit.stream_target,
		read_events: run_event_stream.read_events,
		now_ms: () => Date.now(),
		free_lane_count: ready.free_lane_count,
		ready_count: ready_count_of(ready),
		read_ledger: read_real_ledger,
		mark_offerable: real_mark_offerable,
		emit_stall: real_emit_stall,
	}
}

const DEFAULT_PORTS: DetectPorts = ports_over(backlog_ready.DEFAULT_PORTS)

function ok_reading(): StallReading {
	return { ready_count: NO_READY, free_lanes: NO_FREE, waiting_ms: NO_AGE }
}

// Count the free lanes, and only if one is free read the backlog. A full pool short-circuits before the
// network call — a stall needs a lane to go into.
async function read_counts(ports: DetectPorts): Promise<Counts> {
	const free_lanes = await ports.free_lane_count()

	if (free_lanes <= NO_FREE) return { ready_count: NO_READY, free_lanes }

	return { ready_count: await ports.ready_count(), free_lanes }
}

function has_both(counts: Counts): boolean {
	return counts.ready_count > NO_READY && counts.free_lanes > NO_FREE
}

// How long both have held: from the observation that opened the episode, or zero where this probe opens
// or closes one — and records that change.
async function waiting_ms(
	ports: DetectPorts,
	entries: ReadonlyArray<LedgerEntry>,
	clock: Clock,
	is_offerable: boolean,
): Promise<number> {
	const opened_ms = backlog_stalled.open_offerable_ms(entries, clock.reference_ms)

	if (is_offerable === (opened_ms !== undefined)) return clock.now_ms - (opened_ms ?? clock.now_ms)

	await ports.mark_offerable(is_offerable)

	return NO_AGE
}

// The idle-and-past-threshold branch, where the costly reads finally happen.
async function probe_reading(ports: DetectPorts, clock: Clock): Promise<StallReading> {
	const counts = await read_counts(ports)
	const entries = await ports.read_ledger()
	const waited = await waiting_ms(ports, entries, clock, has_both(counts))

	return { ...counts, waiting_ms: waited, hold: backlog_stalled.open_hold(entries) }
}

// The dispatch reference and the probe's time, or `undefined` when the stream has nothing to age against.
function clock_of(ports: DetectPorts, target: string): Clock | undefined {
	const now_ms = ports.now_ms()
	const age = backlog_stalled.dispatch_age_ms(ports.read_events(target), now_ms)

	return age === undefined ? undefined : { reference_ms: now_ms - age, now_ms }
}

// The reading that decides the verdict, assembled cheap-condition-first. `undefined` is the unreadable
// answer: no stream to key on, so no run to be stalled. Every early return yields a reading the judge
// maps to `ok`; only when the run is idle past the threshold does `probe_reading` make the costly reads.
async function gather(ports: DetectPorts, threshold_ms: number): Promise<StallReading | undefined> {
	const target = await ports.resolve_target()

	if (target === undefined) return undefined

	const clock = clock_of(ports, target)

	if (clock === undefined || clock.now_ms - clock.reference_ms <= threshold_ms) return ok_reading()

	return await probe_reading(ports, clock)
}

// The watcher's once-a-minute arrival probe records the same observation from the reading it already
// made, so an episode opens within a probe interval of work meeting a lane — not at the first stop past
// the dispatch-age gate, which would hide up to one threshold of the wait. Best-effort, like the check.
async function observe_offerable(
	is_offerable: boolean,
	ports: DetectPorts = DEFAULT_PORTS,
): Promise<void> {
	try {
		const target = await ports.resolve_target()
		const clock = target === undefined ? undefined : clock_of(ports, target)

		if (clock !== undefined) await waiting_ms(ports, await ports.read_ledger(), clock, is_offerable)
	} catch {
		// A failed observation is dropped: the next probe records it, and the watcher's loop must not break.
	}
}

// The marker, once per stall episode: `emit_stall` refuses a second until a dispatch has intervened, so a
// stall polled every stop lands on the stream once, not once a turn.
async function report(ports: DetectPorts, reading: StallReading): Promise<void> {
	await ports.emit_stall(backlog_stalled.describe(reading))
}

// Read the three conditions, print nothing, and on a stall leave the marker. The verdict is returned for
// the CLI to print; the side effect is the report's.
async function detect_and_report(
	ports: DetectPorts = DEFAULT_PORTS,
	threshold_ms: number = backlog_stalled.STALL_THRESHOLD_MS,
): Promise<StallVerdict> {
	const reading = await gather(ports, threshold_ms)
	const verdict = backlog_stalled.assess(reading, threshold_ms)

	if (reading !== undefined && verdict === backlog_stalled.STALLED) await report(ports, reading)

	return verdict
}

// Best-effort for the Stop hook: the detector is a report, so a failure to gather or mark is dropped
// rather than raised into the stop decision it rides alongside.
async function run_stall_check(ready: ReadyPorts = backlog_ready.DEFAULT_PORTS): Promise<void> {
	try {
		await detect_and_report(ports_over(ready))
	} catch {
		// Reporting is best-effort: a stall we could not read or send is dropped, never a blocked stop.
	}
}

const backlog_stalled_detect = { detect_and_report, observe_offerable, run_stall_check }

export { backlog_stalled_detect }
export type { DetectPorts }
