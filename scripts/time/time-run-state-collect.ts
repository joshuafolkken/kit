import { cost_pricing } from '#scripts/cost/cost-pricing'
import { cost_transcript, type SessionFile } from '#scripts/cost/cost-transcript'
import type { UsageRecord } from '#scripts/cost/cost-usage'
import { run_carry, type CarryRead } from '#scripts/run/run-carry'
import { run_wake, type RunWake } from '#scripts/run/run-wake'
import { time_run_state, type RunStateFacts, type WhiffSession } from './time-run-state'
import { time_spans, type Span } from './time-spans'

// The I/O half of the run-state block (joshuafolkken/kit#1939): resolve this checkout's records,
// find the wake sessions that did no work, and hand a pure `RunStateFacts` back. The classification
// and rendering are `time-run-state.ts`'s, kept free of disk so a fixture can drive them.
//
// **No detection is re-derived here.** The carry read, the owner-liveness test and the wake read are
// `run-carry` / `run-wake`'s own, exactly as the Issue requires; this places their answers against
// the transcripts and prices the whiffs through the same `cost` reader `josh cost` uses.

const NO_ACTIVITY = undefined

// A carried or expired record carries a `RunCarry`; the two other kinds carry none. Reading the owner
// liveness needs that record, so it is `false` wherever there is nothing to test.
function owner_live_of(carry: CarryRead): boolean {
	if (carry.kind === 'carried' || carry.kind === 'expired') {
		return run_carry.is_owner_live(carry.carry)
	}

	return false
}

// The most recent transcript touch across the checkout, which stands in for "last activity" — a
// stalled run is one whose newest transcript stopped moving. `undefined` where no transcript exists,
// so the block says the idle time is unknown rather than measuring it from a missing file.
function last_activity_of(files: ReadonlyArray<SessionFile>): number | undefined {
	if (files.length === 0) return NO_ACTIVITY

	return Math.max(...files.map((file) => file.modified_ms))
}

// One session, priced, if it is a whiff. Pure given its two reads, so a test fixes both the whiff
// predicate and the pricing without touching disk.
function to_whiff(
	spans: ReadonlyArray<Span>,
	records: ReadonlyArray<UsageRecord>,
	at_ms: number,
): WhiffSession | undefined {
	if (!time_run_state.is_whiff(spans)) return undefined

	// Priced through the same `cost_pricing.cost_of` every other `josh cost` figure uses, so a whiff's
	// dollars cannot diverge from the rest of the report (joshuafolkken/kit#1939).
	const cost_usd = cost_pricing.cost_of(records)

	return { at: new Date(at_ms).toISOString(), cost_usd }
}

function whiff_of(file: SessionFile): WhiffSession | undefined {
	const { spans } = time_spans.parse_timeline(cost_transcript.read_raw(file))

	return to_whiff(spans, cost_transcript.read_session(file).records, file.modified_ms)
}

// The whiffs are the wake supervisor's own doing, so they are looked for only where a wake record
// exists and only among sessions touched since it began. A checkout with no supervisor has no
// wake-spawned session to have whiffed.
function collect_whiffs(
	files: ReadonlyArray<SessionFile>,
	wake: RunWake | undefined,
): Array<WhiffSession> {
	if (wake === undefined) return []

	const since = Date.parse(wake.started_at)

	return files.filter((file) => file.modified_ms >= since).flatMap((file) => whiff_of(file) ?? [])
}

async function read_facts(cwd: string, now_ms: number): Promise<RunStateFacts> {
	const directory = await run_carry.repository_directory()
	const carry: CarryRead =
		directory === undefined
			? { kind: 'none' }
			: run_carry.read_carry(run_carry.carry_path(directory))
	const wake =
		directory === undefined ? undefined : run_wake.read_wake(run_wake.wake_path(directory))
	const files = cost_transcript.list_sessions_across(cost_transcript.transcript_directories(cwd))

	return time_run_state.classify({
		carry,
		is_owner_live: owner_live_of(carry),
		wake,
		now_ms,
		last_activity_ms: last_activity_of(files),
		whiffs: collect_whiffs(files, wake),
	})
}

const time_run_state_collect = { read_facts, to_whiff, collect_whiffs }

export { time_run_state_collect }
