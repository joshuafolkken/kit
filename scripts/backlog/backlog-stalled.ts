import { epic_triage } from '#scripts/epic/epic-triage'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// When ready backlog work sits undispatched while lanes are free, nobody notices until a person asks.
// This is the mechanical judge of that state: three facts read, never
// weighed — is there runnable work, is there a free lane, and has nothing been dispatched for a while.
// The verdict is a report, not a stop: a false positive costs one stream marker, never a halted run.
//
// **Pure by design.** The clock and the counts are handed in, so the four acceptance cases — work with
// a free lane, work with no free lane, no work, and an unreadable record — and the elapsed-time
// boundary are unit-tested without a git tree, a network or a wall clock. The I/O that gathers the
// counts is `backlog-stalled-detect.ts`; this file only decides.

const STALL_THRESHOLD_MINUTES = 10
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
// how long both have held together since the last dispatch — never the idle time before work arrived or
// a long child ran (joshuafolkken/kit#4349). `hold` is the driver's open hold reason (`memory`, …), so a
// deliberate hold reads apart from a slow dispatch. Assembled by the detect layer; consumed only here.
interface StallReading {
	ready_count: number
	free_lanes: number
	waiting_ms: number
	hold?: string | undefined
}

// All three together, and only together. Separated from `assess` so the short-circuit gate in the
// detect layer — the one that decides whether the expensive backlog read is worth making — reads the
// same condition rather than a second copy of it.
function is_stalled(reading: StallReading, threshold_ms: number): boolean {
	return (
		reading.ready_count > NONE && reading.free_lanes > NONE && reading.waiting_ms > threshold_ms
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

// That reference as epoch milliseconds, or `undefined` when there is none or the stamp is unparseable.
function dispatch_reference_ms(events: ReadonlyArray<RunEvent>): number | undefined {
	const iso = dispatch_reference_iso(events)
	const at = iso === undefined ? NaN : Date.parse(iso)

	return Number.isNaN(at) ? undefined : at
}

// Milliseconds since that reference, or `undefined` when there is no reference — the caller reads it as
// "nothing to age against" and returns no stall. A stall cannot be older than this, so it gates the
// costly reads.
function dispatch_age_ms(events: ReadonlyArray<RunEvent>, now_ms: number): number | undefined {
	const at = dispatch_reference_ms(events)

	return at === undefined ? undefined : now_ms - at
}

// When the current coexistence of offerable work and a free lane was first observed: the newest
// observation since the reference, if it saw both. `undefined` when it did not or none was made — an
// observation before the last dispatch belongs to an episode that dispatch ended.
function open_offerable_ms(
	entries: ReadonlyArray<LedgerEntry>,
	reference_ms: number,
): number | undefined {
	const newest = entries.findLast(
		(entry) => entry.kind === lane_ledger.KIND.OFFERABLE && Date.parse(entry.at) >= reference_ms,
	)

	if (newest?.kind !== lane_ledger.KIND.OFFERABLE || !newest.is_offerable) return undefined

	return Date.parse(newest.at)
}

// The driver's open hold reason: the newest of its hold, release and dispatch records, when a hold.
function open_hold(entries: ReadonlyArray<LedgerEntry>): string | undefined {
	const { HELD, RELEASED, DISPATCH } = lane_ledger.KIND
	const hold_kinds: ReadonlySet<string> = new Set([HELD, RELEASED, DISPATCH])
	const newest = entries.findLast((entry) => hold_kinds.has(entry.kind))

	return newest?.kind === lane_ledger.KIND.HELD ? newest.reason : undefined
}

// The one line a person reads in the notification and on the stream: what is waiting, how long, and the
// driver's hold reason when it holds deliberately.
function describe(reading: StallReading): string {
	const minutes = Math.floor(reading.waiting_ms / MS_PER_MINUTE)
	const held = reading.hold === undefined ? '' : ` (held: ${reading.hold})`

	return `${String(reading.ready_count)} ready, ${String(reading.free_lanes)} free lane(s), ${String(minutes)}m waiting with both${held}`
}

// The runnable issue numbers `backlog:next` printed: one token per line, a bare number per runnable
// issue and a verdict word (`wait`, `stop`, …) when there is none — so the numeric lines are the ready
// issues.
function ready_tokens(out: string): ReadonlyArray<string> {
	return out
		.split('\n')
		.map((token) => token.trim())
		.filter((token) => issue_number_shape.is_issue_number(token))
}

function count_ready_tokens(out: string): number {
	return ready_tokens(out).length
}

// Whether `backlog:next` answered `triage`: no number is runnable, yet a session
// has work — judging the untriaged issues — so a reader of the numeric lines alone would take it for an
// empty pool.
function needs_triage(out: string): boolean {
	return out.split('\n').some((token) => token.trim() === epic_triage.TRIAGE_VERDICT)
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
	needs_triage,
	open_hold,
	open_offerable_ms,
	ready_tokens,
}

export { backlog_stalled }
export type { StallReading, StallVerdict }
