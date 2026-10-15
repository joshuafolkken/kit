import type { EndedRun } from '#scripts/run/carry/run-carry-ended'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

const ISSUE_IN_EVENT = /#([1-9]\d*)\b/u
const SETTLED_KINDS: ReadonlySet<string> = new Set([
	run_event_stream.EVENT_KIND.MERGE,
	run_event_stream.EVENT_KIND.PARK,
	run_event_stream.EVENT_KIND.SPLIT,
	run_event_stream.EVENT_KIND.OUTAGE,
	run_event_stream.EVENT_KIND.INTERRUPT,
])
const DONE_KINDS: ReadonlySet<string> = new Set([
	run_event_stream.EVENT_KIND.MERGE,
	run_event_stream.EVENT_KIND.PARK,
	run_event_stream.EVENT_KIND.SPLIT,
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

interface Gap {
	from: string
	to: string
}

function is_unowned_launch(event: RunEvent, gap: Gap | undefined): boolean {
	if (gap === undefined || event.kind !== run_event_stream.EVENT_KIND.CHILD_LAUNCH) return false

	const at = Date.parse(event.at)

	return at > Date.parse(gap.from) && at < Date.parse(gap.to)
}

// The events a driver restores its lanes from: those since the run `--end` last ended began — a run
// handed to a new invocation still owns what the previous one launched — less any launch between that
// run's end and this one's start, which no run made (a `lane:dispatch` by hand) and so none collects.
function run_events(
	events: ReadonlyArray<RunEvent>,
	started_at: string,
	ended: EndedRun | undefined,
): ReadonlyArray<RunEvent> {
	const floor = ended?.started_at ?? started_at
	const gap = ended === undefined ? undefined : { from: ended.ended_at, to: started_at }
	const scoped = run_event_scope.scoped_events(events, { kind: 'since', started_at: floor }) ?? []

	return scoped.filter((event) => !is_unowned_launch(event, gap))
}

function restore(
	lanes: ReadonlyArray<string>,
	events: ReadonlyArray<RunEvent>,
	merged_issues: ReadonlyArray<number>,
): ReadonlyArray<string> {
	const active = active_issues(events)

	return lanes.filter((issue) => active.has(issue) && !merged_issues.includes(Number(issue)))
}

export const backlog_drive_restore = {
	active_issues,
	restore,
	run_events,
	settled_issues,
	parked_issues,
}
