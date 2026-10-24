import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import type { LedgerEntry } from './lane-ledger'
import type { IssueAt } from './lane-spans'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stop_stats } from './lane-stop-stats'

// A lane's net time (joshuafolkken/kit#4749): from its issue's first dispatch to its merge, less the
// waits no fix in the lane shortens — a park (the issue waits on a person's decision) and an outage,
// each until the issue's next ship stage, re-dispatch or another of the two, the wait `josh lane:stats`
// derives for a stop (`lane-stop-stats.ts`). A ship stop is not taken out: a relaunched child works
// through its wait. `josh lane:net` prints it, and a causing-lane line declares it (`issue-priority.ts`).

const { EVENT_KIND } = run_event_stream

interface LaneSpan {
	from_ms: number
	to_ms: number
}

// The first dispatch of `issue` to its merge, or `undefined` while either is missing.
function span_of(entries: ReadonlyArray<LedgerEntry>, issue: number): LaneSpan | undefined {
	const of_issue = entries.filter((entry) => 'issue' in entry && entry.issue === issue)
	const from = of_issue.find((entry) => lane_stage_stats.is_dispatch(entry))
	const to = of_issue.findLast((entry) => lane_stage_stats.is_merge(entry))

	if (from === undefined || to === undefined) return undefined

	return { from_ms: Date.parse(from.at), to_ms: Date.parse(to.at) }
}

function holds_of(events: ReadonlyArray<RunEvent>): Array<IssueAt> {
	return [
		...lane_stop_stats.events_of(events, EVENT_KIND.PARK),
		...lane_stop_stats.events_of(events, EVENT_KIND.OUTAGE),
	]
}

// One hold's wait, cut at the merge: a hold nothing ended before it waited until the merge.
function held_ms(hold: IssueAt, ends: ReadonlyArray<IssueAt>, to_ms: number): number {
	const left_ms = to_ms - hold.at_ms

	return Math.min(lane_stop_stats.wait_ms(hold, ends) ?? left_ms, left_ms)
}

/**
 * The net milliseconds of `issue`'s lane, or `undefined` when the ledger holds no dispatch and merge of
 * it. `events` is the run's event stream, read for the parks and outages.
 */
function net_ms(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): number | undefined {
	const span = span_of(entries, issue)

	if (span === undefined || span.to_ms < span.from_ms) return undefined

	const holds = holds_of(events)
	const inside = holds.filter(
		(hold) => hold.issue === issue && hold.at_ms >= span.from_ms && hold.at_ms < span.to_ms,
	)
	const waits = inside.map((hold) => {
		const ends = lane_stop_stats.ends_of(
			entries,
			holds.filter((other) => other.at_ms > hold.at_ms),
		)

		return held_ms(hold, ends, span.to_ms)
	})

	return waits.reduce((left, wait) => left - wait, span.to_ms - span.from_ms)
}

const lane_net_time = { net_ms }

export { lane_net_time }
