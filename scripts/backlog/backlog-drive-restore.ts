import { run_event_stream, type RunEvent } from '#scripts/run/run-event-stream'

const ISSUE_IN_EVENT = /#([1-9]\d*)\b/u
const SETTLED_KINDS: ReadonlySet<string> = new Set([
	run_event_stream.EVENT_KIND.MERGE,
	run_event_stream.EVENT_KIND.PARK,
	run_event_stream.EVENT_KIND.SPLIT,
	run_event_stream.EVENT_KIND.OUTAGE,
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

function restore(
	lanes: ReadonlyArray<string>,
	events: ReadonlyArray<RunEvent>,
	merged_issues: ReadonlyArray<number>,
): ReadonlyArray<string> {
	const active = active_issues(events)

	return lanes.filter((issue) => active.has(issue) && !merged_issues.includes(Number(issue)))
}

export const backlog_drive_restore = { restore }
