import { agent_profile_schema } from '#scripts/agent/agent-profile-schema'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { lane_hand_back_held } from './lane-hand-back-held'
import { lane_ledger, type LedgerEntry, type MergeEntry } from './lane-ledger'
import { lane_spans, type Span } from './lane-spans'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_stop_stats } from './lane-stop-stats'
import { lane_yield_split, type YieldParts } from './lane-yield-split'

// How long a lane slot waited on the lane machinery rather than on work, printed by `josh lane:stats`
// (joshuafolkken/kit#4395). Three hand-offs, each timed from the moment the slot's next step could run:
//
// - `cut → resume`: a child's session cut until the relaunched session resumed the lane.
// - `outage → relaunch`: a child that ended with no result, collected as an `outage`, until its next
//   `child-launch` (joshuafolkken/kit#4410).
// - `park → offer`: a park until the driver's next offer answered — a `held`, `released` or `dispatch`
//   entry. A pool that stays full writes no line after its one `released`, and a driver handed back
//   writes none, so a gap over the offer interval is a full pool or no driver, never the hand-over
//   (joshuafolkken/kit#4410). The ship's cap park and the driver's collection of it are each timed.
// - `yield → redispatch`: a yield (`lane:plan` gave the seat back) until its issue's next `dispatch`, the
//   wait `josh lane:net` takes out (`lane-net-time.ts`, joshuafolkken/kit#5216). Its rows below split it
//   into the holder running, the wait for the next offer and the launch, a yield naming no holder
//   counted apart (`lane-yield-split.ts`, joshuafolkken/kit#5984).
// - `followup → merge`: the ship's last `followup` stage before the merge until the parent wrote the
//   `merge` line, the step that releases the slot. A merge with no `followup` stage has no start.
// - `start → first lane`: a `backlogrun` session's `starting session` until its first `opening lane`
//   (`run_event_setup.first_lane_spans`, joshuafolkken/kit#5519) — the start-up a run waits through
//   before any lane works.
//
// A start nothing ended is counted under `not ended`, kept out of the seconds.

const COLUMNS = ['gap', 'count', 'median (s)', 'max (s)', 'not ended'] as const
const RELAUNCH = 'cut → resume'
const OUTAGE = 'outage → relaunch'
const PARK = 'park → offer'
const YIELD = 'yield → redispatch'
const YIELD_PART = {
	HOLDER: 'yield: holder running',
	OFFER: 'yield: offer wait',
	LAUNCH: 'yield: launch',
	UNKNOWN: 'yield: holder unknown',
} as const
const MERGE = 'followup → merge'
const FIRST_LANE = 'start → first lane'
const FOLLOWUP_STAGE = 'followup'
const IMPLEMENTATION_CUT = `cut (${agent_profile_schema.IMPLEMENTATION_PHASE})`
const { NOT_MEASURED, is_dispatch, is_merge, is_number, is_stage } = lane_stage_stats
const { EVENT_KIND } = run_event_stream
// The offer answers that are not a dispatch: a free lane held, or the pool found full.
const OFFER_ANSWERS: ReadonlySet<string> = new Set([
	lane_ledger.KIND.HELD,
	lane_ledger.KIND.RELEASED,
])

// Only an implementation cut appends a `resume` when it is adopted; a pre-gate resume appends nothing,
// so its cut would read as never ended (`run-cut-resume.ts` → `emit_resume_event`).
function implementation_cuts(events: ReadonlyArray<RunEvent>): Array<RunEvent> {
	return events.filter((event) => event.text.endsWith(IMPLEMENTATION_CUT))
}

function relaunch_spans(events: ReadonlyArray<RunEvent>): Array<Span> {
	return lane_spans.issue_spans({
		starts: lane_stop_stats.events_of(implementation_cuts(events), EVENT_KIND.CUT),
		bounds: lane_stop_stats.events_of(events, EVENT_KIND.CUT),
		ends: lane_stop_stats.events_of(events, EVENT_KIND.RESUME),
	})
}

// A child that ended with no result is collected as an `outage`, re-dispatchable; its next launch is
// the relaunch.
function outage_spans(events: ReadonlyArray<RunEvent>): Array<Span> {
	const outages = lane_stop_stats.events_of(events, EVENT_KIND.OUTAGE)

	return lane_spans.issue_spans({
		starts: outages,
		bounds: outages,
		ends: lane_stop_stats.events_of(events, EVENT_KIND.CHILD_LAUNCH),
	})
}

// A driverless hold answers no offer: no driver ran to make one (joshuafolkken/kit#7121).
function is_offer_answer(entry: LedgerEntry): boolean {
	if (entry.kind === lane_ledger.KIND.HELD) return !lane_hand_back_held.is_driverless(entry.reason)

	return is_dispatch(entry) || OFFER_ANSWERS.has(entry.kind)
}

function offer_times(entries: ReadonlyArray<LedgerEntry>): Array<number> {
	return entries
		.filter((entry) => is_offer_answer(entry))
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

// `started` is the spans already reduced to the period.
function span_row(name: string, started: ReadonlyArray<Span>): string {
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

function gap_row(name: string, spans: ReadonlyArray<Span>, window: StatsWindow): string {
	return span_row(
		name,
		spans.filter((span) => is_in(span, window)),
	)
}

function waits_of(parts: ReadonlyArray<YieldParts>): Array<Span> {
	return parts.map((part) => part.wait)
}

// The yield row, then its parts (`lane-yield-split.ts`): each split by the yield's own start, so a
// yield the period holds keeps every part, and the split and the unknown counts add up to its count.
function yield_rows(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	window: StatsWindow,
): Array<string> {
	const inside = lane_yield_split.parts(entries, events).filter((part) => is_in(part.wait, window))
	const unknown = inside.filter((part) => part.holder === undefined)

	return [
		span_row(YIELD, waits_of(inside)),
		span_row(
			YIELD_PART.HOLDER,
			inside.flatMap((part) => part.holder ?? []),
		),
		span_row(
			YIELD_PART.OFFER,
			inside.flatMap((part) => part.offer ?? []),
		),
		span_row(
			YIELD_PART.LAUNCH,
			inside.flatMap((part) => part.launch ?? []),
		),
		span_row(YIELD_PART.UNKNOWN, waits_of(unknown)),
	]
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
		gap_row(OUTAGE, outage_spans(events), window),
		gap_row(PARK, park_spans(entries, events), window),
		...yield_rows(entries, events, window),
		gap_row(MERGE, merge_spans(entries), window),
		gap_row(FIRST_LANE, run_event_setup.first_lane_spans(events), window),
	].join('\n')
}

const lane_gap_stats = { table }

export { lane_gap_stats }
