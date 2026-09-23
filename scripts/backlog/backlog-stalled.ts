import { run_event_stream, type RunEvent } from '#scripts/run/run-event-stream'

// When ready backlog work sits undispatched while lanes are free, nobody notices until a person asks
// (joshuafolkken/kit#2359). This is the mechanical judge of that state: three facts read, never
// weighed — is there runnable work, is there a free lane, and has nothing been dispatched for a while.
// The verdict is a report, not a stop: a false positive costs one notification, never a halted run.
//
// **Pure by design.** The clock and the counts are handed in, so the four acceptance cases — work with
// a free lane, work with no free lane, no work, and an unreadable record — and the elapsed-time
// boundary are unit-tested without a git tree, a network or a wall clock. The I/O that gathers the
// counts is `backlog-stalled-detect.ts`; this file only decides.

const STALL_THRESHOLD_MINUTES = 10
const MS_PER_MINUTE = 60_000
const STALL_THRESHOLD_MS = STALL_THRESHOLD_MINUTES * MS_PER_MINUTE
const NONE = 0

// `stalled` when all three conditions hold, `unreadable` when the dispatch record could not be read at
// all, `ok` otherwise. An issue number is never one of these — they are the only three answers. The
// verdicts carry this type rather than a bare literal so the exported `backlog_stalled` namespace does
// not widen them to `string` at the object boundary (object-literal widening).
type StallVerdict = 'stalled' | 'ok' | 'unreadable'

const STALLED: StallVerdict = 'stalled'
const OK: StallVerdict = 'ok'
const UNREADABLE: StallVerdict = 'unreadable'

// The three facts, read and never judged: how many issues could start now, how many lanes are free, and
// how long since the last dispatch. Assembled by the detect layer; consumed only here.
interface StallReading {
	ready_count: number
	free_lanes: number
	dispatch_age_ms: number
}

// All three together, and only together. Separated from `assess` so the short-circuit gate in the
// detect layer — the one that decides whether the expensive backlog read is worth making — reads the
// same condition rather than a second copy of it.
function is_stalled(reading: StallReading, threshold_ms: number): boolean {
	return (
		reading.ready_count > NONE &&
		reading.free_lanes > NONE &&
		reading.dispatch_age_ms > threshold_ms
	)
}

// **The verdict, and the whole of the judgement.** An unread record answers first — `undefined` is the
// detect layer saying it could not resolve the run's own stream — so a missing record never reads as a
// stall. The boundary is strict: exactly at the threshold is not yet a stall, one millisecond past it
// is.
function assess(reading: StallReading | undefined, threshold_ms: number): StallVerdict {
	if (reading === undefined) return UNREADABLE
	if (is_stalled(reading, threshold_ms)) return STALLED

	return OK
}

// The time a stall is measured from: the newest dispatch (`child-launch`), or — before the first
// dispatch — the run's earliest recorded event, so a run that has never dispatched is still aged from
// when it began. `undefined` for a stream with nothing on it: there is no run to be stalled.
function dispatch_reference_iso(events: ReadonlyArray<RunEvent>): string | undefined {
	const last_launch = events.findLast(
		(event) => event.kind === run_event_stream.EVENT_KIND.CHILD_LAUNCH,
	)

	return last_launch?.at ?? events[0]?.at
}

// Milliseconds since that reference, or `undefined` when there is no reference or the stamp is
// unparseable — the caller reads either as "nothing to age against" and returns no stall.
function dispatch_age_ms(events: ReadonlyArray<RunEvent>, now_ms: number): number | undefined {
	const iso = dispatch_reference_iso(events)

	if (iso === undefined) return undefined

	const at = Date.parse(iso)

	return Number.isNaN(at) ? undefined : now_ms - at
}

// The one line a person reads in the notification and on the stream: what is waiting and how long.
function describe(reading: StallReading): string {
	const minutes = Math.floor(reading.dispatch_age_ms / MS_PER_MINUTE)

	return `${String(reading.ready_count)} ready, ${String(reading.free_lanes)} free lane(s), ${String(minutes)}m since the last dispatch`
}

const NUMERIC_TOKEN = /^\d+$/u

// The runnable issue numbers `backlog:next` printed: one token per line, a bare number per runnable
// issue and a verdict word (`wait`, `stop`, …) when there is none — so the numeric lines are the ready
// issues.
function ready_tokens(out: string): ReadonlyArray<string> {
	return out
		.split('\n')
		.map((token) => token.trim())
		.filter((token) => NUMERIC_TOKEN.test(token))
}

function count_ready_tokens(out: string): number {
	return ready_tokens(out).length
}

const backlog_stalled = {
	STALLED,
	OK,
	UNREADABLE,
	STALL_THRESHOLD_MS,
	assess,
	count_ready_tokens,
	describe,
	dispatch_age_ms,
	is_stalled,
	ready_tokens,
}

export { backlog_stalled }
export type { StallReading, StallVerdict }
