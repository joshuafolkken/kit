import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { lane_ledger, type LedgerEntry, type MergeEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_stop_stats } from './lane-stop-stats'

// How long a lane slot waited on the lane machinery rather than on work, printed by `josh lane:stats`
// (joshuafolkken/kit#4395). Three hand-offs, each timed from the moment the slot's next step could run:
//
// - `cut → resume`: a child's session cut until the relaunched session resumed the lane.
// - `park → offer`: a park until the driver's next offer answered — a `held` or a `dispatch` entry.
//   The driver writes one per offered pass, so the gap is the slot's hand-over, never the wait for
//   runnable work after it. The ship's cap park and the driver's collection of it are each timed.
// - `followup → merge`: the ship's last `followup` stage before the merge until the parent wrote the
//   `merge` line, the step that releases the slot. A merge with no `followup` stage has no start.
//
// A start nothing ended is counted under `not ended`, kept out of the seconds.

const COLUMNS = ['gap', 'count', 'median (s)', 'max (s)', 'not ended'] as const
const RELAUNCH = 'cut → resume'
const PARK = 'park → offer'
const MERGE = 'followup → merge'
const FOLLOWUP_STAGE = 'followup'
const IMPLEMENTATION_CUT = `cut (${agent_role_profile.IMPLEMENTATION_PHASE})`
const { NOT_MEASURED, is_dispatch, is_number, is_stage } = lane_stage_stats
const { EVENT_KIND } = run_event_stream

interface Span {
	from_ms: number
	end_ms: number | undefined
}

// Only an implementation cut appends a `resume` when it is adopted; a pre-gate resume appends nothing,
// so its cut would read as never ended (`run-cut-cli.ts` → `emit_resume_event`).
function implementation_cuts(events: ReadonlyArray<RunEvent>): Array<RunEvent> {
	return events.filter((event) => event.text.endsWith(IMPLEMENTATION_CUT))
}

function relaunch_spans(events: ReadonlyArray<RunEvent>): Array<Span> {
	const resumes = lane_stop_stats.events_of(events, EVENT_KIND.RESUME)
	const cuts = lane_stop_stats.events_of(implementation_cuts(events), EVENT_KIND.CUT)

	return cuts.map((cut) => ({
		from_ms: cut.at_ms,
		end_ms: resumes.find((resume) => resume.issue === cut.issue && resume.at_ms >= cut.at_ms)
			?.at_ms,
	}))
}

function offer_times(entries: ReadonlyArray<LedgerEntry>): Array<number> {
	return entries
		.filter((entry) => is_dispatch(entry) || entry.kind === lane_ledger.KIND.HELD)
		.map((entry) => Date.parse(entry.at))
		.toSorted((left, right) => left - right)
}

function park_spans(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
): Array<Span> {
	const offers = offer_times(entries)

	return lane_stop_stats
		.events_of(events, EVENT_KIND.PARK)
		.map((park) => ({ from_ms: park.at_ms, end_ms: offers.find((at) => at > park.at_ms) }))
}

function is_merge(entry: LedgerEntry): entry is MergeEntry {
	return entry.kind === lane_ledger.KIND.MERGE
}

function is_followup_of(entry: LedgerEntry, merge: MergeEntry): boolean {
	return (
		is_stage(entry) &&
		entry.stage === FOLLOWUP_STAGE &&
		entry.issue === merge.issue &&
		entry.at <= merge.at
	)
}

function merge_span(entries: ReadonlyArray<LedgerEntry>, merge: MergeEntry): Span | undefined {
	const followup = entries.findLast((entry) => is_followup_of(entry, merge))

	return followup === undefined
		? undefined
		: { from_ms: Date.parse(followup.at), end_ms: Date.parse(merge.at) }
}

function merge_spans(entries: ReadonlyArray<LedgerEntry>): Array<Span> {
	return entries
		.filter((entry) => is_merge(entry))
		.map((merge) => merge_span(entries, merge))
		.filter((span) => span !== undefined)
}

function seconds(milliseconds: number | undefined): string {
	return milliseconds === undefined
		? NOT_MEASURED
		: String(Math.round(milliseconds / MS_PER_SECOND))
}

function is_in(span: Span, window: StatsWindow): boolean {
	return span.from_ms >= window.since_ms && span.from_ms <= window.until_ms
}

function gap_row(name: string, spans: ReadonlyArray<Span>, window: StatsWindow): string {
	const started = spans.filter((span) => is_in(span, window))
	const ended = started
		.map((span) => (span.end_ms === undefined ? undefined : span.end_ms - span.from_ms))
		.filter((value) => is_number(value))

	return lane_stats.to_row([
		name,
		String(started.length),
		seconds(lane_stats.median(ended)),
		seconds(lane_stats.peak(ended)),
		String(started.length - ended.length),
	])
}

// The period's table: `entries` is the whole ledger and `events` the whole run-event stream, both
// reduced here to the spans that started in `window`.
function table(
	entries: ReadonlyArray<LedgerEntry>,
	window: StatsWindow,
	events: ReadonlyArray<RunEvent> = [],
): string {
	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		gap_row(RELAUNCH, relaunch_spans(events), window),
		gap_row(PARK, park_spans(entries, events), window),
		gap_row(MERGE, merge_spans(entries), window),
	].join('\n')
}

const lane_gap_stats = { table }

export { lane_gap_stats }
