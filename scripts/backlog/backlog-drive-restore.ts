import { lane_yield } from '#scripts/lane/lane-yield'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { backlog_offer_exclude } from './backlog-offer-exclude'

const ISSUE_IN_EVENT = /#([1-9]\d*)\b/u
const SETTLED_KINDS: ReadonlySet<string> = new Set([
	run_event_stream.EVENT_KIND.MERGE,
	run_event_stream.EVENT_KIND.PARK,
	run_event_stream.EVENT_KIND.HUMAN_REVIEW,
	run_event_stream.EVENT_KIND.SPLIT,
	run_event_stream.EVENT_KIND.WITHDRAW,
	run_event_stream.EVENT_KIND.OUTAGE,
	run_event_stream.EVENT_KIND.USAGE_LIMIT,
])
const DONE_KINDS: ReadonlySet<string> = new Set([
	run_event_stream.EVENT_KIND.MERGE,
	run_event_stream.EVENT_KIND.PARK,
	run_event_stream.EVENT_KIND.HUMAN_REVIEW,
	run_event_stream.EVENT_KIND.SPLIT,
	run_event_stream.EVENT_KIND.WITHDRAW,
])

function issue_of(event: RunEvent): string | undefined {
	return ISSUE_IN_EVENT.exec(event.text)?.[1]
}

function update_active(active: Set<string>, event: RunEvent): void {
	const issue = issue_of(event)

	if (issue === undefined) return
	if (event.kind === run_event_stream.EVENT_KIND.CHILD_LAUNCH) active.add(issue)
	if (SETTLED_KINDS.has(event.kind)) active.delete(issue)
}

function active_issues(events: ReadonlyArray<RunEvent>): ReadonlySet<string> {
	const active = new Set<string>()

	for (const event of events) update_active(active, event)

	return active
}

// A yield is not among them: it gave its lane back without settling the issue (`lane-yield.ts`).
function settled_issues(events: ReadonlyArray<RunEvent>): ReadonlySet<number> {
	const settled = events.filter(
		(event) => DONE_KINDS.has(event.kind) && !lane_yield.is_yield(event),
	)

	return new Set(
		settled
			.map((event) => issue_of(event))
			.filter((issue) => issue !== undefined)
			.map(Number),
	)
}

function issues_of_kind(events: ReadonlyArray<RunEvent>, kind: string): ReadonlyArray<string> {
	return events
		.filter((event) => event.kind === kind)
		.map((event) => issue_of(event))
		.filter((issue) => issue !== undefined)
}

// The issues a person withdrew from this run and nobody launched again: the withdrawal leaves the issue
// open for the next run, so this one keeps it out of the offer (joshuafolkken/kit#4365). A lane that
// yielded stays in the run: its retained plan holds it back until the holder ends (`lane-yield.ts`).
function withdrawn_issues(events: ReadonlyArray<RunEvent>): ReadonlyArray<string> {
	const named = issues_of_kind(events, run_event_stream.EVENT_KIND.WITHDRAW)

	return named.filter(
		(issue) => run_event_scope.is_withdrawn(events, issue) && !lane_yield.is_yielded(events, issue),
	)
}

// The offer's exclusion as the stream records it: the merged and withdrawn children and the ones still
// in flight — the list the drive keeps in memory, read by a reader that has only the stream
// (joshuafolkken/kit#4349).
function offer_exclude(events: ReadonlyArray<RunEvent>): ReadonlyArray<string> {
	const merged = issues_of_kind(events, run_event_stream.EVENT_KIND.MERGE)
	const settled = [...merged, ...withdrawn_issues(events)]

	return backlog_offer_exclude.exclude_of(settled, active_issues(events))
}

function parked_issues(events: ReadonlyArray<RunEvent>): ReadonlySet<number> {
	return new Set(issues_of_kind(events, run_event_stream.EVENT_KIND.PARK).map(Number))
}

// The issues this invocation launched or settled — any other dispatched lane was carried in from an
// earlier invocation.
function mentioned_issues(events: ReadonlyArray<RunEvent>): ReadonlySet<string> {
	const tracked = events.filter(
		(event) =>
			event.kind === run_event_stream.EVENT_KIND.CHILD_LAUNCH || SETTLED_KINDS.has(event.kind),
	)

	return new Set(tracked.map((event) => issue_of(event)).filter((issue) => issue !== undefined))
}

// The lanes still in flight: launched by this invocation and not settled, or dispatched by an earlier
// one and never seen by this one — a lane nobody collects otherwise waits forever.
function restore(
	lanes: ReadonlyArray<string>,
	events: ReadonlyArray<RunEvent>,
	merged_issues: ReadonlyArray<number>,
	dispatched: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
	const active = active_issues(events)
	const mentioned = mentioned_issues(events)
	const carried = new Set(dispatched.filter((issue) => !mentioned.has(issue)))

	return lanes.filter(
		(issue) => (active.has(issue) || carried.has(issue)) && !merged_issues.includes(Number(issue)),
	)
}

export const backlog_drive_restore = {
	active_issues,
	mentioned_issues,
	offer_exclude,
	restore,
	withdrawn_issues,
	settled_issues,
	parked_issues,
}
