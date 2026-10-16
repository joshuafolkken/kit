import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

const ISSUE_IN_EVENT = /#([1-9]\d*)\b/u
const SETTLED_KINDS: ReadonlySet<string> = new Set([
	run_event_stream.EVENT_KIND.MERGE,
	run_event_stream.EVENT_KIND.PARK,
	run_event_stream.EVENT_KIND.SPLIT,
	run_event_stream.EVENT_KIND.WITHDRAW,
	run_event_stream.EVENT_KIND.OUTAGE,
])
const DONE_KINDS: ReadonlySet<string> = new Set([
	run_event_stream.EVENT_KIND.MERGE,
	run_event_stream.EVENT_KIND.PARK,
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

function settled_issues(events: ReadonlyArray<RunEvent>): ReadonlySet<number> {
	const settled = events.filter((event) => DONE_KINDS.has(event.kind))

	return new Set(
		settled
			.map((event) => issue_of(event))
			.filter((issue) => issue !== undefined)
			.map(Number),
	)
}

function parked_issues(events: ReadonlyArray<RunEvent>): ReadonlySet<number> {
	return new Set(
		events
			.filter((event) => event.kind === run_event_stream.EVENT_KIND.PARK)
			.map((event) => issue_of(event))
			.filter((issue) => issue !== undefined)
			.map(Number),
	)
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

export const backlog_drive_restore = { active_issues, restore, settled_issues, parked_issues }
