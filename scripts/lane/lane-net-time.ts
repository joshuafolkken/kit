import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import type { LedgerEntry } from './lane-ledger'
import { lane_sleep } from './lane-sleep'
import { lane_spans, type IssueAt, type Span } from './lane-spans'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stop_stats } from './lane-stop-stats'
import { lane_yield } from './lane-yield'

// A lane's net time (joshuafolkken/kit#4749): from its issue's first dispatch to its merge, less the
// waits no fix in the lane shortens — a park (the issue waits on a person's decision), an outage and a
// usage-limit stop (joshuafolkken/kit#4745), each until the issue's next ship stage, re-dispatch or
// another of the two, the wait `josh lane:stats` derives for a stop (`lane-stop-stats.ts`) — and the
// host's sleeps (joshuafolkken/kit#5032), whatever the issue (`lane-sleep.ts`), and a yield's wait for
// the issue's next dispatch (joshuafolkken/kit#5216), no lane seat held while the holder runs, and a
// run that ended in a split until the next dispatch (joshuafolkken/kit#6678), the parts' cost. The
// ship's followup — CI, CodeRabbit and the merge, waited on by the driver with no lane seat held — is
// taken out too, counted apart as a driver stage (joshuafolkken/kit#6541). A ship stop is not taken
// out: a relaunched child works through its wait. `josh lane:net` prints it, and a causing-lane line
// declares it (`issue-priority.ts`).

const { EVENT_KIND } = run_event_stream
const { PHASE, STAGE } = run_ship_stage

interface LaneSpan {
	from_ms: number
	to_ms: number
}

function entries_of(entries: ReadonlyArray<LedgerEntry>, issue: number): Array<LedgerEntry> {
	return entries.filter((entry) => 'issue' in entry && entry.issue === issue)
}

// The first dispatch of `issue` to its merge, or `undefined` while either is missing or the merge comes
// first.
function span_of(entries: ReadonlyArray<LedgerEntry>, issue: number): LaneSpan | undefined {
	const of_issue = entries_of(entries, issue)
	const from = of_issue.find((entry) => lane_stage_stats.is_dispatch(entry))
	const to = of_issue.findLast((entry) => lane_stage_stats.is_merge(entry))

	if (from === undefined || to === undefined) return undefined

	const span = { from_ms: Date.parse(from.at), to_ms: Date.parse(to.at) }

	return span.to_ms < span.from_ms ? undefined : span
}

function holds_of(events: ReadonlyArray<RunEvent>): Array<IssueAt> {
	return [
		...lane_stop_stats.events_of(events, EVENT_KIND.PARK),
		...lane_stop_stats.events_of(events, EVENT_KIND.OUTAGE),
		...lane_stop_stats.events_of(events, EVENT_KIND.USAGE_LIMIT),
	]
}

// One hold's wait, cut at the merge: a hold nothing ended before it waited until the merge.
function held_ms(hold: IssueAt, ends: ReadonlyArray<IssueAt>, to_ms: number): number {
	const left_ms = to_ms - hold.at_ms

	return Math.min(lane_stop_stats.wait_ms(hold, ends) ?? left_ms, left_ms)
}

function hold_waits(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
	span: LaneSpan,
): Array<LaneSpan> {
	const holds = holds_of(events)
	const inside = holds.filter(
		(hold) => hold.issue === issue && hold.at_ms >= span.from_ms && hold.at_ms < span.to_ms,
	)

	return inside.map((hold) => {
		const ends = lane_stop_stats.ends_of(
			entries,
			holds.filter((other) => other.at_ms > hold.at_ms),
		)

		return { from_ms: hold.at_ms, to_ms: hold.at_ms + held_ms(hold, ends, span.to_ms) }
	})
}

// `spans` oldest first with every overlap joined, so a park the host slept through is taken out once.
function joined(spans: ReadonlyArray<LaneSpan>): Array<LaneSpan> {
	const sorted = spans.toSorted((left, right) => left.from_ms - right.from_ms)

	const kept: Array<LaneSpan> = []

	for (const next of sorted) {
		const last = kept.at(-1)

		if (last === undefined || next.from_ms > last.to_ms) kept.push({ ...next })
		else last.to_ms = Math.max(last.to_ms, next.to_ms)
	}

	return kept
}

// The host's sleeps (joshuafolkken/kit#5032) cut to `span` and joined: a sleep stops every lane,
// whatever its issue.
function slept(events: ReadonlyArray<RunEvent>, span: LaneSpan): Array<LaneSpan> {
	const cut = lane_sleep.spans(events).map((sleep) => ({
		from_ms: Math.max(sleep.from_ms, span.from_ms),
		to_ms: Math.min(sleep.to_ms, span.to_ms),
	}))

	return joined(cut.filter((sleep) => sleep.to_ms > sleep.from_ms))
}

// Each yield (`lane:plan` gave the seat back) until its issue's next dispatch, every issue's — the
// `yield → redispatch` gap `josh lane:stats` prints (`lane-gap-stats.ts`). The wait starts at the
// child's yield note, not at the withdrawal `run:merge` may close the lane with later, or never
// (joshuafolkken/kit#5755).
function yield_spans(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
): Array<Span> {
	const yields = lane_stop_stats.events_of(
		events.filter((event) => lane_yield.is_yield_note(event)),
		EVENT_KIND.NOTE,
	)

	return lane_spans.issue_spans({
		starts: yields,
		bounds: yields,
		ends: lane_stop_stats.dispatches_of(entries),
	})
}

// The dispatch that started the run `split` ended: the issue's last dispatch at or before it.
function run_start_ms(dispatches: ReadonlyArray<IssueAt>, split: IssueAt): number {
	const start = dispatches.findLast(
		(entry) => entry.issue === split.issue && entry.at_ms <= split.at_ms,
	)

	return start?.at_ms ?? split.at_ms
}

// Each run that ended with its issue split (`run:merge` closing the lane), from its dispatch until the
// issue's next one: the split run filed the parts, the next run is the lane (joshuafolkken/kit#6678).
// A split no later dispatch followed is no wait.
function split_spans(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
): Array<Span> {
	const splits = lane_stop_stats.events_of(events, EVENT_KIND.SPLIT)
	const dispatches = lane_stop_stats.dispatches_of(entries)
	const spans = lane_spans.issue_spans({ starts: splits, bounds: splits, ends: dispatches })

	return splits
		.map((split, index) => ({
			from_ms: run_start_ms(dispatches, split),
			end_ms: spans[index]?.end_ms,
		}))
		.filter((wait) => wait.end_ms !== undefined)
}

// The waits of `spans` that began inside `span`, each cut at the merge.
function cut_inside(spans: ReadonlyArray<Span>, span: LaneSpan): Array<LaneSpan> {
	const inside = spans.filter((wait) => wait.from_ms >= span.from_ms && wait.from_ms < span.to_ms)

	return inside.map((wait) => ({
		from_ms: wait.from_ms,
		to_ms: Math.min(wait.end_ms ?? span.to_ms, span.to_ms),
	}))
}

function events_of_issue(events: ReadonlyArray<RunEvent>, issue: number): Array<RunEvent> {
	return events.filter((event) => lane_stop_stats.issue_of(event) === issue)
}

// `issue`'s yields inside `span`, each until its redispatch, cut at the merge.
function yielded(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
	span: LaneSpan,
): Array<LaneSpan> {
	return cut_inside(yield_spans(entries, events_of_issue(events, issue)), span)
}

// `issue`'s split runs inside `span`, each until its redispatch, cut at the merge.
function split_waits(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
	span: LaneSpan,
): Array<LaneSpan> {
	return cut_inside(split_spans(entries, events_of_issue(events, issue)), span)
}

// The waits `net_ms` takes out of `span` — each hold from itself to its end, cut at the merge, each
// yield and split run until its redispatch, and each sleep of the host — the intervals `josh
// lane:breakdown` counts as excluded (`lane-breakdown.ts`).
function waits(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
	span: LaneSpan,
): Array<LaneSpan> {
	return joined([
		...hold_waits(entries, events, issue, span),
		...yielded(entries, events, issue, span),
		...split_waits(entries, events, issue, span),
		...slept(events, span),
	])
}

function is_followup_start(event: RunEvent): boolean {
	const { stage, phase } = run_ship_stage.words_of(event.text)

	return stage === STAGE.FOLLOWUP && phase === PHASE.START
}

// `issue`'s ship followups inside `span`, each from its start to the issue's next ship stage line, or
// else the merge — the driver's wait on CI, CodeRabbit and the merge (joshuafolkken/kit#6541).
function followed(events: ReadonlyArray<RunEvent>, issue: number, span: LaneSpan): Array<LaneSpan> {
	const lines = events
		.filter((event) => event.kind === EVENT_KIND.SHIP_STAGE)
		.filter((event) => lane_stop_stats.issue_of(event) === issue)
		.map((event) => ({ event, at_ms: Date.parse(event.at) }))
		.filter((line) => line.at_ms >= span.from_ms && line.at_ms < span.to_ms)
		.toSorted((left, right) => left.at_ms - right.at_ms)

	return lines
		.map((line, index) => ({ line, to_ms: lines[index + 1]?.at_ms ?? span.to_ms }))
		.filter(({ line }) => is_followup_start(line.event))
		.map(({ line, to_ms }) => ({ from_ms: line.at_ms, to_ms }))
}

// Every interval `net_ms` leaves out of `span`: the waits and the driver's followups, joined.
function outside(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
	span: LaneSpan,
): Array<LaneSpan> {
	return joined([...waits(entries, events, issue, span), ...followed(events, issue, span)])
}

/**
 * The net milliseconds of `issue`'s lane, or `undefined` when the ledger holds no dispatch and merge of
 * it. `events` is the run's event stream, read for the parks, outages and followups.
 */
function net_ms(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): number | undefined {
	const span = span_of(entries, issue)

	if (span === undefined) return undefined

	return outside(entries, events, issue, span).reduce(
		(left, wait) => left - (wait.to_ms - wait.from_ms),
		span.to_ms - span.from_ms,
	)
}

// The net time in whole minutes, rounded up — the number a causing-lane line declares.
function net_minutes(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): number | undefined {
	const net = net_ms(entries, events, issue)

	return net === undefined ? undefined : Math.ceil(net / MS_PER_MINUTE)
}

// Why `net_ms` has no answer for `issue` (joshuafolkken/kit#4818): the ledger lacks its dispatch or its
// merge, or holds both with the merge first.
function missing_reason(entries: ReadonlyArray<LedgerEntry>, issue: number): string {
	const of_issue = entries_of(entries, issue)

	if (of_issue.every((entry) => !lane_stage_stats.is_dispatch(entry))) return 'no dispatch'
	if (of_issue.every((entry) => !lane_stage_stats.is_merge(entry))) return 'no merge'

	return 'cause unknown'
}

const lane_net_time = {
	missing_reason,
	net_minutes,
	net_ms,
	outside,
	slept,
	span_of,
	waits,
	yield_spans,
	yielded,
}

export { lane_net_time }
export type { LaneSpan }
